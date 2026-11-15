using UnityEngine;

namespace ButterflyEffect
{
    /// <summary>The floating screen. Shows the stream's texture on a quad and keeps the quad at the video's aspect ratio.</summary>
    [RequireComponent(typeof(MeshRenderer))]
    public class StreamScreen : MonoBehaviour
    {
        [Tooltip("Screen width in metres. Height follows the video's aspect ratio.")]
        public float width = 1.6f;

        Material material;
        Texture shown;

        void Awake()
        {
            material = GetComponent<MeshRenderer>().material; // per-instance copy
            Show(null);
        }

        public void Show(Texture texture)
        {
            if (texture == shown && texture != null) return;
            shown = texture;

            material.mainTexture = texture != null ? texture : Texture2D.blackTexture;
            // Stream frames arrive top row first; Unity textures start at the bottom row. Flip vertically.
            material.mainTextureScale = new Vector2(1f, -1f);
            material.mainTextureOffset = new Vector2(0f, 1f);

            float aspect = texture != null ? (float)texture.width / texture.height : 1280f / 704f;
            transform.localScale = new Vector3(width, width / aspect, 1f);
        }
    }
}
