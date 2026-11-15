using System;
using UnityEngine;

namespace ButterflyEffect
{
    public enum StreamStatus { Disconnected, Connecting, Waiting, Ready }

    /// <summary>Outcome of one model command. Yield on it from a coroutine.</summary>
    public class CommandResult : CustomYieldInstruction
    {
        public bool Done { get; private set; }
        public bool Ok { get; private set; }
        public string Error { get; private set; }
        public override bool keepWaiting => !Done;

        public void Complete(bool ok, string error = null)
        {
            Ok = ok;
            Error = error;
            Done = true;
        }
    }

    /// <summary>
    /// A live connection to a Reactor world model: video in, named commands out.
    /// AndroidWorldStream is the real one (Quest); MockWorldStream stands in for it in the editor.
    /// </summary>
    public abstract class WorldStream : MonoBehaviour
    {
        public StreamStatus Status { get; protected set; } = StreamStatus.Disconnected;

        /// <summary>Latest video frame. Rows are stored top first, so display it flipped vertically.</summary>
        public Texture2D Texture { get; protected set; }

        /// <summary>A message from the model: its type and its data as a JSON object.</summary>
        public event Action<string, string> Message;

        public event Action<string> Error;

        public abstract void Connect(string token, string model);

        /// <summary>Send a command with a JSON object of arguments, e.g. set_shot {"prompt":"..."}.</summary>
        public abstract CommandResult Send(string command, string argsJson);

        public abstract void Disconnect();

        protected void RaiseMessage(string type, string dataJson) => Message?.Invoke(type, dataJson);

        protected void RaiseError(string text) => Error?.Invoke(text);

        /// <summary>Quotes and escapes a string for use inside hand-built JSON.</summary>
        public static string JsonString(string value)
        {
            var builder = new System.Text.StringBuilder(value.Length + 16);
            builder.Append('"');
            foreach (char c in value)
            {
                switch (c)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (c < 0x20) builder.Append("\\u").Append(((int)c).ToString("x4"));
                        else builder.Append(c);
                        break;
                }
            }
            builder.Append('"');
            return builder.ToString();
        }
    }
}
