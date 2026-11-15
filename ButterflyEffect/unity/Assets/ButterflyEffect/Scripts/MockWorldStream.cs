using System.Collections;
using UnityEngine;

namespace ButterflyEffect
{
    /// <summary>
    /// Editor stand-in for the Reactor stream. It never touches the network: it shows a
    /// moving test pattern, logs every command, and reports chunks on the model's schedule
    /// so the story flow and the UI can be exercised in Play mode on the Mac.
    /// </summary>
    public class MockWorldStream : WorldStream
    {
        const int Width = 320, Height = 176;
        const float ChunkSeconds = 1.83f;
        const int SceneChunkLimit = 2000;

        Color32[] pixels;
        bool generating;
        int sceneChunk;
        float chunkTimer;
        Color32 tint = new Color32(60, 20, 20, 255);

        public override void Connect(string token, string model)
        {
            Debug.Log($"[MockWorldStream] connect to {model}");
            StartCoroutine(BecomeReady());
        }

        IEnumerator BecomeReady()
        {
            Status = StreamStatus.Connecting;
            yield return new WaitForSeconds(0.5f);
            Status = StreamStatus.Waiting;
            yield return new WaitForSeconds(0.5f);
            Texture = new Texture2D(Width, Height, TextureFormat.RGBA32, false) { name = "Mock stream" };
            pixels = new Color32[Width * Height];
            Status = StreamStatus.Ready;
        }

        public override CommandResult Send(string command, string argsJson)
        {
            Debug.Log($"[MockWorldStream] {command} {argsJson}");
            var result = new CommandResult();
            if (Status != StreamStatus.Ready)
            {
                result.Complete(false, "not ready");
                return result;
            }

            switch (command)
            {
                case "start":
                    generating = true; sceneChunk = 0; chunkTimer = 0;
                    break;
                case "reset":
                    generating = false; sceneChunk = 0;
                    break;
                case "set_prompt":
                    tint = Color.HSVToRGB(Random.value, 0.6f, 0.35f);
                    break;
            }
            result.Complete(true);
            return result;
        }

        public override void Disconnect()
        {
            StopAllCoroutines();
            generating = false;
            Status = StreamStatus.Disconnected;
        }

        void Update()
        {
            if (Status != StreamStatus.Ready || Texture == null) return;
            Paint();

            if (!generating) return;
            chunkTimer += Time.deltaTime;
            if (chunkTimer < ChunkSeconds) return;
            chunkTimer = 0;
            sceneChunk++;
            RaiseMessage("chunk_complete", $"{{\"chunk_index\":{sceneChunk},\"session_chunk\":{sceneChunk}}}");
            if (sceneChunk >= SceneChunkLimit)
            {
                generating = false;
                RaiseMessage("generation_complete", $"{{\"total_chunks\":{sceneChunk}}}");
            }
        }

        void Paint()
        {
            // Scrolling diagonal bands. Row 0 is the top of the picture, like the real stream.
            int shift = (int)(Time.time * 40f);
            for (int y = 0; y < Height; y++)
            {
                for (int x = 0; x < Width; x++)
                {
                    bool band = ((x + y + shift) / 24) % 2 == 0;
                    bool top = y < 12; // bright strip marks the top edge, to check orientation
                    pixels[y * Width + x] = top ? new Color32(230, 230, 230, 255)
                        : band && generating ? tint
                        : new Color32(12, 12, 14, 255);
                }
            }
            Texture.SetPixels32(pixels);
            Texture.Apply(false);
        }
    }
}
