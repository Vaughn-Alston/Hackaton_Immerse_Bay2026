using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

namespace ButterflyEffect
{
    [Serializable]
    public class SessionInfo
    {
        public string token;
        public string model;
        public long expiresAt;
        public string error;
        public string detail;
    }

    /// <summary>Calls the token server (server/server.mjs). The Reactor API key never reaches this app.</summary>
    public static class SessionClient
    {
        public static IEnumerator FetchStory(string serverUrl, Action<Story> onDone, Action<string> onError)
        {
            using var request = UnityWebRequest.Get(serverUrl.TrimEnd('/') + "/story");
            request.timeout = 10;
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success)
            {
                onError($"Cannot reach the server at {serverUrl} ({request.error})");
                yield break;
            }
            Story story = null;
            try { story = JsonUtility.FromJson<Story>(request.downloadHandler.text); }
            catch (Exception e) { onError("Story file is not valid: " + e.Message); yield break; }
            if (story?.nodes == null || story.Find(story.start) == null) { onError("Story file has no start scene"); yield break; }
            onDone(story);
        }

        public static IEnumerator RequestSession(string serverUrl, Action<SessionInfo> onDone, Action<string> onError)
        {
            using var request = new UnityWebRequest(serverUrl.TrimEnd('/') + "/session", UnityWebRequest.kHttpVerbPOST)
            {
                downloadHandler = new DownloadHandlerBuffer(),
                timeout = 20,
            };
            yield return request.SendWebRequest();

            SessionInfo info = null;
            string body = request.downloadHandler?.text;
            if (!string.IsNullOrEmpty(body))
            {
                try { info = JsonUtility.FromJson<SessionInfo>(body); } catch (Exception) { /* reported below */ }
            }
            if (info != null && !string.IsNullOrEmpty(info.token)) { onDone(info); yield break; }

            onError(info != null && !string.IsNullOrEmpty(info.error)
                ? $"{info.error} {info.detail}".Trim()
                : $"Cannot get a session from {serverUrl} ({request.error})");
        }
    }
}
