using System;
using System.Collections;
using UnityEngine;

namespace ButterflyEffect
{
    /// <summary>
    /// Runs the story: gets a session from the token server, connects the stream, and walks
    /// the story graph. A "cut" node starts a new scene, a "shot" node continues the current
    /// one, and nodes with choices wait for the viewer.
    ///
    /// Model commands are Visko Orbis's (set_prompt, start, reset): a new prompt morphs the
    /// running picture, and a new scene is started as a fresh run.
    /// </summary>
    public class StoryDirector : MonoBehaviour
    {
        [Tooltip("Address of server/server.mjs on your network, as printed when the server starts.")]
        public string serverUrl = "http://192.168.1.10:8787";

        public StreamScreen screen;
        public ChoicePanel panel;

        [Tooltip("Moved in front of the viewer when the app starts. Parent of the screen and the panel.")]
        public Transform stage;

        public float stageDistance = 2.0f;

        WorldStream stream;
        Story story;
        bool started, runEnded, running;
        Coroutine flow;

        IEnumerator Start()
        {
            stream = Application.platform == RuntimePlatform.Android
                ? gameObject.AddComponent<AndroidWorldStream>()
                : (WorldStream)gameObject.AddComponent<MockWorldStream>();
            stream.Message += OnMessage;
            stream.Error += text => { Debug.LogWarning("[Reactor] " + text); panel.SetStatus(text); };

            ShowBegin("An anger monster follows people through ordinary days. Your choices decide where it goes next.");

            // Wait for head tracking before placing the stage, so it lands in front of the viewer.
            yield return new WaitForSeconds(1.0f);
            PlaceStage();
        }

        void Update()
        {
            if (stream != null && stream.Texture != null) screen.Show(stream.Texture);
        }

        void PlaceStage()
        {
            var head = Camera.main;
            if (head == null || stage == null) return;
            Vector3 forward = Vector3.ProjectOnPlane(head.transform.forward, Vector3.up);
            if (forward.sqrMagnitude < 0.001f) forward = Vector3.forward;
            forward.Normalize();
            float eyeHeight = head.transform.position.y > 0.5f ? head.transform.position.y : 1.4f;
            stage.position = new Vector3(head.transform.position.x, eyeHeight, head.transform.position.z) + forward * stageDistance;
            stage.rotation = Quaternion.LookRotation(forward, Vector3.up);
        }

        void ShowBegin(string caption)
        {
            panel.SetCaption(caption);
            panel.ShowChoices(new[] { "Begin" }, _ => Begin());
        }

        void Begin()
        {
            if (running) return;
            running = true;
            flow = StartCoroutine(Run());
        }

        IEnumerator Run()
        {
            string failure = null;

            panel.SetCaption("");
            panel.SetStatus("Loading the story");
            story = null;
            yield return SessionClient.FetchStory(serverUrl, s => story = s, e => failure = e);
            if (failure != null) { Fail(failure); yield break; }

            panel.SetStatus("Requesting a session");
            SessionInfo session = null;
            yield return SessionClient.RequestSession(serverUrl, s => session = s, e => failure = e);
            if (failure != null) { Fail(failure); yield break; }

            panel.SetStatus("Connecting to " + session.model);
            started = false;
            runEnded = false;
            stream.Connect(session.token, session.model);

            float deadline = Time.time + 90f;
            while (stream.Status != StreamStatus.Ready)
            {
                if (Time.time > deadline) { Fail("Timed out waiting for the model"); yield break; }
                if (stream.Status == StreamStatus.Disconnected) { Fail("Could not connect to the model"); yield break; }
                if (stream.Status == StreamStatus.Waiting) panel.SetStatus("Waiting for a GPU");
                yield return null;
            }

            yield return Play(story.Find(story.start));
        }

        IEnumerator Play(StoryNode node)
        {
            while (node != null)
            {
                panel.ClearChoices();
                panel.SetCaption(node.caption);
                panel.SetStatus("");
                string args = "{\"prompt\":" + WorldStream.JsonString(story.PromptFor(node)) + "}";

                // set_prompt morphs the running picture into the new description.
                // A new scene ("cut") is a fresh run instead: reset, set the prompt, start.
                bool sent = false;
                if (started && !runEnded && !node.IsCut)
                {
                    var change = stream.Send("set_prompt", args);
                    yield return change;
                    sent = change.Ok;
                }
                if (!sent)
                {
                    if (started) yield return stream.Send("reset", "{}");
                    yield return stream.Send("set_audio_enabled", "{\"audio_enabled\":false}"); // video only; refusal is harmless
                    var prompt = stream.Send("set_prompt", args);
                    yield return prompt;
                    var start = stream.Send("start", "{}");
                    yield return start;
                    if (!prompt.Ok || !start.Ok) { Fail("The model refused the scene: " + (prompt.Error ?? start.Error)); yield break; }
                    started = true;
                    runEnded = false;
                }

                if (node.end)
                {
                    yield return new WaitForSeconds(25f);
                    Stop("The cycle is broken.");
                    yield break;
                }

                if (node.HasChoices)
                {
                    int picked = -1;
                    var labels = Array.ConvertAll(node.choices, c => c.label);
                    panel.ShowChoices(labels, i => picked = i);
                    while (picked < 0)
                    {
                        if (stream.Status == StreamStatus.Disconnected) { Fail("The session ended"); yield break; }
                        yield return null;
                    }
                    node = story.Find(node.choices[picked].next);
                }
                else
                {
                    yield return new WaitForSeconds(node.holdSeconds > 0 ? node.holdSeconds : 12f);
                    node = story.Find(node.next);
                }
            }
            Stop("The story has no next scene.");
        }

        void OnMessage(string type, string dataJson)
        {
            if (type == "generation_complete")
            {
                runEnded = true;
                panel.SetStatus("The scene has played out. Choose to continue.");
            }
        }

        void Fail(string reason)
        {
            Debug.LogError("[ButterflyEffect] " + reason);
            Stop(reason);
        }

        /// <summary>Ends the session (which stops billing) and returns to the Begin screen.</summary>
        void Stop(string caption)
        {
            if (flow != null) StopCoroutine(flow);
            flow = null;
            running = false;
            started = false;
            stream.Disconnect();
            panel.SetStatus("");
            ShowBegin(caption);
        }

        void OnApplicationPause(bool paused)
        {
            // Headset taken off or app sent to the background: do not leave a paid session running.
            if (paused && running) Stop("Paused. Begin again when you are ready.");
        }
    }
}
