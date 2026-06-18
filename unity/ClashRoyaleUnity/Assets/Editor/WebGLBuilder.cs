using System;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace ClashRoyale.Editor
{
    /// <summary>
    /// Batch-mode WebGL build entry point. Invoke headless with:
    ///   Unity -batchmode -quit -projectPath . -buildTarget WebGL \
    ///     -executeMethod ClashRoyale.Editor.WebGLBuilder.Build
    /// The output folder is taken from the CR_WEBGL_OUT env var (defaults to
    /// ./WebGLBuild). Drop the result into the web project's public/unity/.
    /// </summary>
    public static class WebGLBuilder
    {
        public static void Build()
        {
            string outPath = Environment.GetEnvironmentVariable("CR_WEBGL_OUT");
            if (string.IsNullOrEmpty(outPath))
            {
                outPath = "WebGLBuild";
            }

            // Keep the build correct over tiny: aggressive stripping was dropping
            // classes the runtime needs (BoxCollider, MonoScript) on this project.
            PlayerSettings.stripEngineCode = false;
            PlayerSettings.SetManagedStrippingLevel(BuildTargetGroup.WebGL, ManagedStrippingLevel.Minimal);

            // Runtime-created materials reference these shaders; nothing references
            // them as assets, so they would be stripped (magenta / no sky). Keep them.
            EnsureShaderIncluded("Standard");
            EnsureShaderIncluded("CR/Outline");
            EnsureShaderIncluded("Skybox/Procedural");

            var options = new BuildPlayerOptions
            {
                scenes = new[] { "Assets/Scenes/Battle.unity" },
                locationPathName = outPath,
                target = BuildTarget.WebGL,
                options = BuildOptions.None,
            };

            BuildReport report = BuildPipeline.BuildPlayer(options);
            BuildSummary summary = report.summary;
            Debug.Log($"WebGL build {summary.result}: {summary.totalSize} bytes at {outPath}");
            EditorApplication.Exit(summary.result == BuildResult.Succeeded ? 0 : 1);
        }

        /// <summary>Add a shader to "Always Included Shaders" so it survives the build.</summary>
        private static void EnsureShaderIncluded(string shaderName)
        {
            Shader shader = Shader.Find(shaderName);
            if (shader == null)
            {
                Debug.LogWarning($"Shader '{shaderName}' not found; skipping always-include.");
                return;
            }

            var graphicsSettings = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(
                "ProjectSettings/GraphicsSettings.asset");
            if (graphicsSettings == null)
            {
                return;
            }

            var so = new SerializedObject(graphicsSettings);
            SerializedProperty list = so.FindProperty("m_AlwaysIncludedShaders");
            for (int i = 0; i < list.arraySize; i++)
            {
                if (list.GetArrayElementAtIndex(i).objectReferenceValue == shader)
                {
                    return; // already present
                }
            }

            list.InsertArrayElementAtIndex(list.arraySize);
            list.GetArrayElementAtIndex(list.arraySize - 1).objectReferenceValue = shader;
            so.ApplyModifiedProperties();
            AssetDatabase.SaveAssets();
            Debug.Log($"Added '{shaderName}' to Always Included Shaders.");
        }
    }
}
