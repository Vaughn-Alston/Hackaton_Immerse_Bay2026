using UnityEngine;
using UnityEngine.InputSystem;

namespace ButterflyEffect
{
    /// <summary>
    /// A ray from one controller (or tracked hand). Point at a choice and pull the trigger
    /// (or pinch) to pick it. Lives under the XR Origin's Camera Offset, because controller
    /// poses are reported relative to that transform.
    /// </summary>
    [RequireComponent(typeof(LineRenderer))]
    public class HandPointer : MonoBehaviour
    {
        public enum Hand { LeftHand, RightHand }

        public Hand hand = Hand.RightHand;
        public float idleLength = 1.5f;

        /// <summary>How many pointers currently have a tracked pose. The panel's gaze fallback checks this.</summary>
        public static int ActiveCount { get; private set; }

        InputAction position, rotation, tracked, select;
        LineRenderer line;
        bool counted, wasPressed;

        void Awake()
        {
            line = GetComponent<LineRenderer>();
            line.useWorldSpace = true;
            line.positionCount = 2;
            line.startWidth = 0.006f;
            line.endWidth = 0.002f;
            line.enabled = false;

            string device = $"<XRController>{{{hand}}}";
            position = new InputAction("Aim position", InputActionType.Value, device + "/pointerPosition", expectedControlType: "Vector3");
            rotation = new InputAction("Aim rotation", InputActionType.Value, device + "/pointerRotation", expectedControlType: "Quaternion");
            tracked = new InputAction("Tracked", InputActionType.Value, device + "/isTracked");
            select = new InputAction("Select", InputActionType.Value);
            select.AddBinding(device + "/{TriggerButton}");   // controller trigger
            select.AddBinding(device + "/pointerActivated");  // hand tracking: pinch
        }

        void OnEnable() { position.Enable(); rotation.Enable(); tracked.Enable(); select.Enable(); }

        void OnDisable()
        {
            position.Disable(); rotation.Disable(); tracked.Disable(); select.Disable();
            SetCounted(false);
            line.enabled = false;
        }

        void Update()
        {
            bool hasPose = position.controls.Count > 0 && tracked.ReadValue<float>() > 0.5f;
            SetCounted(hasPose);
            line.enabled = hasPose;
            if (!hasPose) { wasPressed = false; return; }

            Transform space = transform.parent;
            Vector3 origin = position.ReadValue<Vector3>();
            Quaternion aim = rotation.ReadValue<Quaternion>();
            if (space != null)
            {
                origin = space.TransformPoint(origin);
                aim = space.rotation * aim;
            }
            Vector3 direction = aim * Vector3.forward;

            ChoiceButton target = null;
            Vector3 end = origin + direction * idleLength;
            if (Physics.Raycast(origin, direction, out var hit, 10f))
            {
                target = hit.collider.GetComponent<ChoiceButton>();
                if (target != null) { end = hit.point; target.Hover(); }
            }
            line.SetPosition(0, origin);
            line.SetPosition(1, end);

            bool pressed = select.ReadValue<float>() > 0.5f;
            if (pressed && !wasPressed && target != null) target.Click();
            wasPressed = pressed;
        }

        void SetCounted(bool value)
        {
            if (counted == value) return;
            counted = value;
            ActiveCount += value ? 1 : -1;
        }
    }
}
