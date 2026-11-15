using System;
using System.Collections.Generic;

namespace ButterflyEffect
{
    // Mirrors prompt/story.json, which the token server serves at /story.

    [Serializable]
    public class StoryChoice
    {
        public string label;
        public string next;
    }

    [Serializable]
    public class StoryNode
    {
        public string id;
        public string transition;   // "cut" = new scene, "shot" = same scene continues
        public string caption;
        public string prompt;
        public float holdSeconds;   // for nodes without choices: how long before moving to `next`
        public string next;
        public bool end;
        public StoryChoice[] choices;

        public bool HasChoices => choices != null && choices.Length > 0;
        public bool IsCut => transition == "cut";
    }

    [Serializable]
    public class Story
    {
        public string monster;
        public string style;
        public string start;
        public StoryNode[] nodes;

        Dictionary<string, StoryNode> byId;

        public StoryNode Find(string id)
        {
            if (byId == null)
            {
                byId = new Dictionary<string, StoryNode>();
                foreach (var node in nodes) byId[node.id] = node;
            }
            return id != null && byId.TryGetValue(id, out var found) ? found : null;
        }

        /// <summary>The node's prompt with the shared monster description and style filled in.</summary>
        public string PromptFor(StoryNode node) =>
            node.prompt.Replace("{monster}", monster).Replace("{style}", style);
    }
}
