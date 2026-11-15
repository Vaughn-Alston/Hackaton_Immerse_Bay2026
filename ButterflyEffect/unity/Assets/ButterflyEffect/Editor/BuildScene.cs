using System.Linq;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using Unity.XR.CoreUtils;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.Rendering;
using UnityEngine.XR.ARFoundation;

namespace ButterflyEffect.EditorTools
{
    /// <summary>
    /// Builds the whole scene from code, so nothing depends on hand-wiring in the editor:
    /// menu ButterflyEffect > Build Scene. Safe to run again; it overwrites Main.unity.
    /// </summary>
    public static class BuildScene
    {
        const string Folder = "Assets/ButterflyEffect";
        const string ScenePath = Folder + "/Main.unity";
        const int ServerPort = 8787;

        [MenuItem("ButterflyEffect/Build Scene")]
        public static void Build()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            // --- XR rig: origin > camera offset > head camera + two pointers ---
            var origin = new GameObject("XR Origin").AddComponent<XROrigin>();
            var offset = new GameObject("Camera Offset").transform;
            offset.SetParent(origin.transform, false);

            var cameraObject = new GameObject("Main Camera") { tag = "MainCamera" };
            cameraObject.transform.SetParent(offset, false);
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0, 0, 0, 0); // transparent black: passthrough shows wherever nothing is drawn
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 50f;
            cameraObject.AddComponent<AudioListener>();

            var driver = cameraObject.AddComponent<TrackedPoseDriver>();
            driver.positionInput = new InputActionProperty(new InputAction("Head position", InputActionType.Value, "<XRHMD>/centerEyePosition", expectedControlType: "Vector3"));
            driver.rotationInput = new InputActionProperty(new InputAction("Head rotation", InputActionType.Value, "<XRHMD>/centerEyeRotation", expectedControlType: "Quaternion"));
            driver.ignoreTrackingState = true;

            cameraObject.AddComponent<ARCameraManager>(); // turns passthrough on with the Meta OpenXR camera feature

            origin.Camera = camera;
            origin.CameraFloorOffsetObject = offset.gameObject;
            origin.RequestedTrackingOriginMode = XROrigin.TrackingOriginMode.Floor;

            var pointerMaterial = SaveMaterial("Pointer", new Color(0.95f, 0.45f, 0.25f));
            NewPointer("Left Pointer", HandPointer.Hand.LeftHand, offset, pointerMaterial);
            NewPointer("Right Pointer", HandPointer.Hand.RightHand, offset, pointerMaterial);

            new GameObject("AR Session").AddComponent<ARSession>();

            // --- Stage: the screen with the choice panel beneath it ---
            var stage = new GameObject("Stage").transform;
            stage.position = new Vector3(0, 1.4f, 2f);

            var screenObject = GameObject.CreatePrimitive(PrimitiveType.Quad);
            screenObject.name = "Screen";
            Object.DestroyImmediate(screenObject.GetComponent<Collider>());
            screenObject.transform.SetParent(stage, false);
            screenObject.transform.localPosition = new Vector3(0, 0.15f, 0);
            screenObject.transform.localScale = new Vector3(1.6f, 0.88f, 1f);
            var renderer = screenObject.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = SaveMaterial("Screen", Color.white);
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            var screen = screenObject.AddComponent<StreamScreen>();

            var panelObject = new GameObject("Choice Panel");
            panelObject.transform.SetParent(stage, false);
            panelObject.transform.localPosition = new Vector3(0, -0.65f, -0.08f);
            panelObject.transform.localRotation = Quaternion.Euler(18f, 0, 0); // tilted up toward the viewer
            var panel = panelObject.AddComponent<ChoicePanel>();

            var director = new GameObject("Story Director").AddComponent<StoryDirector>();
            director.screen = screen;
            director.panel = panel;
            director.stage = stage;
            director.serverUrl = $"http://{LocalAddress()}:{ServerPort}";

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
            Debug.Log($"[ButterflyEffect] Scene built at {ScenePath}. Server Url set to {director.serverUrl}");
        }

        /// <summary>Builds the scene, then an APK at Builds/ButterflyEffect.apk. Also usable from the command line.</summary>
        [MenuItem("ButterflyEffect/Build APK")]
        public static void BuildApk()
        {
            Build();
            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                target = BuildTarget.Android,
                locationPathName = "Builds/ButterflyEffect.apk",
                options = BuildOptions.Development,
            };
            var report = BuildPipeline.BuildPlayer(options);
            Debug.Log($"[ButterflyEffect] Build {report.summary.result}: {report.summary.totalErrors} errors, {report.summary.outputPath}");
            if (Application.isBatchMode)
                EditorApplication.Exit(report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded ? 0 : 1);
        }

        static void NewPointer(string name, HandPointer.Hand hand, Transform parent, Material material)
        {
            var pointer = new GameObject(name);
            pointer.transform.SetParent(parent, false);
            var line = pointer.AddComponent<LineRenderer>();
            line.sharedMaterial = material;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            pointer.AddComponent<HandPointer>().hand = hand;
        }

        static Material SaveMaterial(string name, Color color)
        {
            string path = $"{Folder}/{name}.mat";
            var shader = Shader.Find("Universal Render Pipeline/Unlit");
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }
            material.shader = shader;
            material.color = color;
            EditorUtility.SetDirty(material);
            return material;
        }

        // This Mac's address on the local network, which is where the headset reaches the token server.
        static string LocalAddress()
        {
            var address = NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .SelectMany(n => n.GetIPProperties().UnicastAddresses)
                .Select(a => a.Address)
                .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !a.ToString().StartsWith("169.254."));
            return address != null ? address.ToString() : "localhost";
        }
    }
}
