using System.Collections.Generic;
using ClashRoyale.Sim;
using UnityEngine;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Renders each card's actual 3D model to a cached RenderTexture so the HUD
    /// can show real card art (like the web build) instead of a letter glyph.
    /// Models are staged far off-screen on a dedicated layer that only the
    /// portrait camera sees.
    /// </summary>
    public static class CardPortrait
    {
        private const int PortraitLayer = 30;
        private static Camera cam;
        private static readonly Dictionary<CardId, RenderTexture> Cache = new();
        private static readonly Vector3 Stage = new Vector3(0f, 500f, 0f);

        public static void Init(Camera mainCamera)
        {
            // Keep the staged models out of the battle camera.
            mainCamera.cullingMask &= ~(1 << PortraitLayer);

            var go = new GameObject("PortraitCamera");
            go.transform.position = Stage + new Vector3(0f, 1.0f, -3.2f);
            cam = go.AddComponent<Camera>();
            cam.cullingMask = 1 << PortraitLayer;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0f, 0f, 0f, 0f);
            cam.orthographic = true;
            cam.orthographicSize = 1.15f;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 10f;
            cam.enabled = false; // rendered on demand
            cam.transform.LookAt(Stage + new Vector3(0f, 0.9f, 0f));

            var lightGo = new GameObject("PortraitLight");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.1f;
            light.cullingMask = 1 << PortraitLayer;
            lightGo.transform.position = Stage;
            lightGo.transform.rotation = Quaternion.Euler(35f, 20f, 0f);
        }

        public static Texture Get(CardId id)
        {
            if (cam == null)
            {
                return null;
            }

            if (Cache.TryGetValue(id, out RenderTexture cached))
            {
                return cached;
            }

            var rt = new RenderTexture(256, 256, 16, RenderTextureFormat.ARGB32)
            {
                antiAliasing = 2,
            };

            GameObject model = BuildStaged(id);
            cam.targetTexture = rt;
            cam.Render();
            cam.targetTexture = null;
            Object.Destroy(model);

            Cache[id] = rt;
            return rt;
        }

        private static GameObject BuildStaged(CardId id)
        {
            GameObject model;
            if (KayKitModels.TryBuild(id, Side.Player, 0.5f, out GameObject m, out CharacterAnim anim, out _))
            {
                model = m;
                if (anim != null)
                {
                    Object.Destroy(anim); // no animation needed for a still
                }

                model.transform.localScale = Vector3.one * 0.9f;
            }
            else
            {
                model = CharacterFactory.Build(id, Side.Player, 0.5f, false);
                model.transform.localScale = Vector3.one * 0.85f;
            }

            model.transform.position = Stage;
            model.transform.rotation = Quaternion.Euler(0f, 200f, 0f);
            SetLayer(model.transform, PortraitLayer);
            return model;
        }

        private static void SetLayer(Transform t, int layer)
        {
            t.gameObject.layer = layer;
            foreach (Transform c in t)
            {
                SetLayer(c, layer);
            }
        }
    }
}
