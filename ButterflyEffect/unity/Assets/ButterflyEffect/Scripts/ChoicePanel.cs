using System;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace ButterflyEffect
{
    /// <summary>One selectable row on the choice panel. Pointers call Hover() each frame and Click() on trigger.</summary>
    public class ChoiceButton : MonoBehaviour
    {
        public int Index;
        public ChoicePanel Panel;
        public Image Background;
        public RectTransform DwellBar;
        public Text Label;

        int hoverFrame = -1;

        public bool Hovered => hoverFrame >= Time.frameCount - 1;

        public void Hover() => hoverFrame = Time.frameCount;

        public void Click() => Panel.Pick(Index);
    }

    /// <summary>
    /// The panel under the screen: a caption, up to three choices and a status line.
    /// It builds its own UI at start. Choices can be picked with a controller ray and
    /// trigger (HandPointer), by looking at one for a moment, or with keys 1/2/3 in the editor.
    /// </summary>
    public class ChoicePanel : MonoBehaviour
    {
        const float PixelsPerMetre = 1000f;
        const float Width = 1600f, Height = 620f;
        const float GazeDwellSeconds = 1.6f;

        static readonly Color Normal = new Color(0.10f, 0.10f, 0.12f, 0.92f);
        static readonly Color Highlight = new Color(0.55f, 0.16f, 0.10f, 0.96f);
        static readonly string[] Letters = { "A", "B", "C" };

        Text caption, status;
        readonly ChoiceButton[] buttons = new ChoiceButton[3];
        Action<int> onPick;
        ChoiceButton gazeTarget;
        float gazeTime, gazeBlockedUntil;

        void Awake()
        {
            var canvas = gameObject.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            var rect = (RectTransform)transform;
            rect.sizeDelta = new Vector2(Width, Height);
            rect.localScale = Vector3.one / PixelsPerMetre;

            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

            var backdrop = NewRect("Backdrop", transform, 0, 0, Width, Height).gameObject.AddComponent<Image>();
            backdrop.color = new Color(0.03f, 0.03f, 0.04f, 0.80f);

            caption = NewText("Caption", font, 44, TextAnchor.UpperLeft, 40, 24, Width - 80, 150);
            for (int i = 0; i < buttons.Length; i++) buttons[i] = NewButton(i, font, 40, 190 + i * 122, Width - 80, 108);
            status = NewText("Status", font, 28, TextAnchor.LowerLeft, 40, Height - 56, Width - 80, 40);
            status.color = new Color(0.62f, 0.61f, 0.58f);

            ClearChoices();
        }

        public void SetCaption(string text) => caption.text = text ?? "";

        public void SetStatus(string text) => status.text = text ?? "";

        public void ShowChoices(string[] labels, Action<int> pick)
        {
            onPick = pick;
            for (int i = 0; i < buttons.Length; i++)
            {
                bool used = i < labels.Length;
                buttons[i].gameObject.SetActive(used);
                if (used) buttons[i].Label.text = labels.Length == 1 ? labels[i] : $"{Letters[i]}.   {labels[i]}";
            }
            gazeTarget = null;
            gazeTime = 0f;
            gazeBlockedUntil = Time.time + 1.5f; // time to read before a look can select anything
        }

        public void ClearChoices()
        {
            onPick = null;
            foreach (var button in buttons) button.gameObject.SetActive(false);
            gazeTarget = null;
        }

        public void Pick(int index)
        {
            var pick = onPick;
            if (pick == null) return;
            ClearChoices();
            pick(index);
        }

        void Update()
        {
            if (onPick == null) return;
            ReadKeyboard();
            UpdateGaze();
            foreach (var button in buttons)
            {
                if (!button.gameObject.activeSelf) continue;
                bool lit = button.Hovered || button == gazeTarget;
                button.Background.color = lit ? Highlight : Normal;
                float progress = button == gazeTarget ? Mathf.Clamp01(gazeTime / GazeDwellSeconds) : 0f;
                button.DwellBar.localScale = new Vector3(progress, 1f, 1f);
            }
        }

        void ReadKeyboard()
        {
            var keyboard = Keyboard.current;
            if (keyboard == null) return;
            if (keyboard.digit1Key.wasPressedThisFrame && buttons[0].gameObject.activeSelf) Pick(0);
            else if (keyboard.digit2Key.wasPressedThisFrame && buttons[1].gameObject.activeSelf) Pick(1);
            else if (keyboard.digit3Key.wasPressedThisFrame && buttons[2].gameObject.activeSelf) Pick(2);
        }

        // Hands-free fallback: when no controller or hand ray is active, looking at a choice selects it.
        void UpdateGaze()
        {
            var head = Camera.main;
            ChoiceButton looked = null;
            if (head != null && HandPointer.ActiveCount == 0 && Time.time >= gazeBlockedUntil &&
                Physics.Raycast(head.transform.position, head.transform.forward, out var hit, 10f))
            {
                looked = hit.collider.GetComponent<ChoiceButton>();
            }

            if (looked != gazeTarget)
            {
                gazeTarget = looked;
                gazeTime = 0f;
                return;
            }
            if (gazeTarget == null) return;

            gazeTime += Time.deltaTime;
            if (gazeTime >= GazeDwellSeconds) gazeTarget.Click();
        }

        // Layout helpers. Coordinates are pixels from the panel's top-left corner.

        RectTransform NewRect(string name, Transform parent, float x, float y, float width, float height)
        {
            var rect = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = rect.anchorMax = new Vector2(0, 1);
            rect.pivot = new Vector2(0, 1);
            rect.anchoredPosition = new Vector2(x, -y);
            rect.sizeDelta = new Vector2(width, height);
            return rect;
        }

        Text NewText(string name, Font font, int size, TextAnchor anchor, float x, float y, float width, float height, Transform parent = null)
        {
            var text = NewRect(name, parent != null ? parent : transform, x, y, width, height).gameObject.AddComponent<Text>();
            text.font = font;
            text.fontSize = size;
            text.alignment = anchor;
            text.color = new Color(0.91f, 0.90f, 0.89f);
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            text.raycastTarget = false;
            return text;
        }

        ChoiceButton NewButton(int index, Font font, float x, float y, float width, float height)
        {
            var rect = NewRect("Choice " + Letters[index], transform, x, y, width, height);
            var button = rect.gameObject.AddComponent<ChoiceButton>();
            button.Index = index;
            button.Panel = this;
            button.Background = rect.gameObject.AddComponent<Image>();
            button.Background.color = Normal;

            var bar = NewRect("Dwell", rect, 0, height - 8, width, 8);
            bar.gameObject.AddComponent<Image>().color = new Color(0.95f, 0.45f, 0.25f);
            bar.localScale = new Vector3(0, 1, 1);
            button.DwellBar = bar;

            button.Label = NewText("Label", font, 38, TextAnchor.MiddleLeft, 28, 0, width - 56, height - 8, rect);

            // Pointers find buttons by physics raycast. The collider is centred on the rect (pivot is top-left).
            var box = rect.gameObject.AddComponent<BoxCollider>();
            box.center = new Vector3(width / 2f, -height / 2f, 0f);
            box.size = new Vector3(width, height, 20f);
            return button;
        }
    }
}
