using System;
using System.Collections.Generic;
using Unity.Collections;
using UnityEngine;

namespace ButterflyEffect
{
    /// <summary>
    /// Talks to Reactor through Assets/Plugins/Android/ReactorBridge.kt, which wraps the
    /// official Reactor Android SDK. Events are polled once per frame; video frames are
    /// copied straight from the bridge's native buffer into a texture.
    /// </summary>
    public class AndroidWorldStream : WorldStream
    {
        [Serializable]
        class BridgeEvent
        {
            public string kind;    // status | message | reply | error
            public string status;
            public string type;
            public string data;
            public int id;
            public bool ok;
            public string code;
            public string text;
        }

        AndroidJavaObject bridge;
        readonly Dictionary<int, CommandResult> pending = new Dictionary<int, CommandResult>();
        int nextId = 1;

        void Awake()
        {
            bridge = new AndroidJavaObject("com.butterflyeffect.reactor.ReactorBridge");
        }

        public override void Connect(string token, string model)
        {
            Status = StreamStatus.Connecting;
            bridge.Call("connect", token, model);
        }

        public override CommandResult Send(string command, string argsJson)
        {
            var result = new CommandResult();
            int id = nextId++;
            pending[id] = result;
            bridge.Call("sendCommand", id, command, argsJson);
            return result;
        }

        public override void Disconnect()
        {
            bridge?.Call("disconnect");
            FailPending("disconnected");
            Status = StreamStatus.Disconnected;
        }

        void Update()
        {
            if (bridge == null) return;
            PumpEvents();
            PumpVideo();
        }

        void PumpEvents()
        {
            for (int i = 0; i < 64; i++)
            {
                string json = bridge.Call<string>("pollEvent");
                if (string.IsNullOrEmpty(json)) return;

                var e = JsonUtility.FromJson<BridgeEvent>(json);
                switch (e.kind)
                {
                    case "status":
                        Status = ParseStatus(e.status);
                        if (Status == StreamStatus.Disconnected) FailPending("disconnected");
                        break;
                    case "message":
                        RaiseMessage(e.type, string.IsNullOrEmpty(e.data) ? "{}" : e.data);
                        break;
                    case "reply":
                        if (pending.Remove(e.id, out var result))
                            result.Complete(e.ok, e.ok ? null : $"{e.code} {e.text}".Trim());
                        break;
                    case "error":
                        RaiseError($"{e.code} {e.text}".Trim());
                        break;
                }
            }
        }

        void PumpVideo()
        {
            using var buffer = bridge.Call<AndroidJavaObject>("readFrame");
            if (buffer == null) return;

            int width = bridge.Call<int>("frameWidth");
            int height = bridge.Call<int>("frameHeight");
            int size = width * height * 4;
            if (size <= 0) return;

            NativeArray<byte> pixels = AndroidJNI.GetDirectByteBuffer(buffer.GetRawObject());
            if (!pixels.IsCreated || pixels.Length < size) return;

            if (Texture == null || Texture.width != width || Texture.height != height)
            {
                if (Texture != null) Destroy(Texture);
                Texture = new Texture2D(width, height, TextureFormat.BGRA32, false)
                {
                    wrapMode = TextureWrapMode.Clamp,
                    name = "Reactor main_video",
                };
            }
            Texture.SetPixelData(pixels.GetSubArray(0, size), 0);
            Texture.Apply(false);
        }

        void FailPending(string reason)
        {
            foreach (var result in pending.Values) result.Complete(false, reason);
            pending.Clear();
        }

        static StreamStatus ParseStatus(string status)
        {
            switch (status)
            {
                case "connecting": return StreamStatus.Connecting;
                case "waiting": return StreamStatus.Waiting;
                case "ready": return StreamStatus.Ready;
                default: return StreamStatus.Disconnected;
            }
        }

        void OnDestroy()
        {
            if (bridge == null) return;
            bridge.Call("disconnect"); // ends the session, which stops billing
            bridge.Dispose();
            bridge = null;
        }
    }
}
