using UnityEngine;
using UnityEngine.Rendering;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Shared rendering helpers: lit materials, the cartoon inverted-hull outline,
    /// primitive builders, and small procedural textures. Keeps the look cohesive
    /// and the rest of the code terse.
    /// </summary>
    public static class Visuals
    {
        private static Shader standardShader;
        private static Shader outlineShader;
        public static readonly Color OutlineColor = new Color(0.05f, 0.06f, 0.10f, 1f);

        public static Material Lit(Color color, float smoothness = 0.18f, float metallic = 0f, Color? emission = null)
        {
            if (standardShader == null)
            {
                standardShader = Shader.Find("Standard");
            }

            var m = new Material(standardShader) { color = color };
            m.SetFloat("_Glossiness", smoothness);
            m.SetFloat("_Metallic", metallic);
            if (emission.HasValue)
            {
                m.EnableKeyword("_EMISSION");
                m.SetColor("_EmissionColor", emission.Value);
                m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            }

            return m;
        }

        /// <summary>A transparent (alpha-blended) Standard material, e.g. for the deploy zone.</summary>
        public static Material Transparent(Color color)
        {
            if (standardShader == null)
            {
                standardShader = Shader.Find("Standard");
            }

            var m = new Material(standardShader);
            m.SetFloat("_Mode", 3f);
            m.SetInt("_SrcBlend", (int)BlendMode.SrcAlpha);
            m.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
            m.SetInt("_ZWrite", 0);
            m.DisableKeyword("_ALPHATEST_ON");
            m.EnableKeyword("_ALPHABLEND_ON");
            m.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            m.renderQueue = 3000;
            m.color = color;
            return m;
        }

        private static Material OutlineMaterial(float width)
        {
            if (outlineShader == null)
            {
                outlineShader = Shader.Find("CR/Outline");
            }

            if (outlineShader == null)
            {
                return null;
            }

            var m = new Material(outlineShader);
            m.SetColor("_OutlineColor", OutlineColor);
            m.SetFloat("_OutlineWidth", width);
            return m;
        }

        /// <summary>Create a parented, coloured primitive (no collider), optionally outlined.</summary>
        public static GameObject Part(
            PrimitiveType type, Transform parent, Color color,
            Vector3 localPos, Vector3 localScale, Quaternion? rot = null,
            bool outline = true, float smoothness = 0.18f, float metallic = 0f,
            Color? emission = null, float outlineWidth = 0.04f)
        {
            GameObject go = GameObject.CreatePrimitive(type);
            Object.Destroy(go.GetComponent<Collider>());
            var rend = go.GetComponent<Renderer>();
            rend.sharedMaterial = Lit(color, smoothness, metallic, emission);
            rend.shadowCastingMode = ShadowCastingMode.On;
            rend.receiveShadows = true;

            Transform t = go.transform;
            t.SetParent(parent, false);
            t.localPosition = localPos;
            t.localRotation = rot ?? Quaternion.identity;
            t.localScale = localScale;

            if (outline)
            {
                AddOutline(go, outlineWidth);
            }

            return go;
        }

        public static void AddOutline(GameObject src, float width = 0.04f)
        {
            var mf = src.GetComponent<MeshFilter>();
            Material mat = OutlineMaterial(width);
            if (mf == null || mat == null)
            {
                return;
            }

            var o = new GameObject("outline");
            o.transform.SetParent(src.transform, false);
            o.AddComponent<MeshFilter>().sharedMesh = mf.sharedMesh;
            var mr = o.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = false;
        }

        // ---- procedural textures -----------------------------------------

        /// <summary>A stone-tile texture: warm base, grout border, subtle grain.</summary>
        public static Texture2D StoneTile(Color baseCol, Color grout)
        {
            const int n = 64;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, true);
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    bool edge = x < 3 || y < 3 || x > n - 4 || y > n - 4;
                    float grain = (Hash(x, y) - 0.5f) * 0.06f;
                    Color c = edge ? grout : baseCol;
                    c.r = Mathf.Clamp01(c.r + grain);
                    c.g = Mathf.Clamp01(c.g + grain);
                    c.b = Mathf.Clamp01(c.b + grain);
                    tex.SetPixel(x, y, c);
                }
            }

            tex.wrapMode = TextureWrapMode.Repeat;
            tex.filterMode = FilterMode.Bilinear;
            tex.Apply(true);
            return tex;
        }

        private static float Hash(int x, int y)
        {
            int h = x * 374761393 + y * 668265263;
            h = (h ^ (h >> 13)) * 1274126177;
            return ((h ^ (h >> 16)) & 0xffff) / 65535f;
        }

        // ---- uGUI sprites -------------------------------------------------

        private static Sprite roundedCache;

        /// <summary>A white rounded-rect sprite (9-slice) for clean uGUI panels/cards.</summary>
        public static Sprite RoundedSprite()
        {
            if (roundedCache != null)
            {
                return roundedCache;
            }

            const int n = 32;
            const int r = 9;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, false);
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    tex.SetPixel(x, y, InRounded(x, y, n, r) ? Color.white : Color.clear);
                }
            }

            tex.filterMode = FilterMode.Bilinear;
            tex.wrapMode = TextureWrapMode.Clamp;
            tex.Apply();
            roundedCache = Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f), 100f,
                0, SpriteMeshType.FullRect, new Vector4(r, r, r, r));
            return roundedCache;
        }

        private static bool InRounded(int x, int y, int n, int r)
        {
            int cx = Mathf.Clamp(x, r, n - 1 - r);
            int cy = Mathf.Clamp(y, r, n - 1 - r);
            float dx = x - cx;
            float dy = y - cy;
            return dx * dx + dy * dy <= (r + 0.5f) * (r + 0.5f);
        }

        private static Sprite circleCache;

        /// <summary>A white solid-circle sprite for cost gems / dots.</summary>
        public static Sprite CircleSprite()
        {
            if (circleCache != null)
            {
                return circleCache;
            }

            const int n = 48;
            float c = (n - 1) / 2f;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, false);
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    float d = Mathf.Sqrt((x - c) * (x - c) + (y - c) * (y - c));
                    tex.SetPixel(x, y, d <= c - 0.5f ? Color.white : Color.clear);
                }
            }

            tex.filterMode = FilterMode.Bilinear;
            tex.Apply();
            circleCache = Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f), 100f);
            return circleCache;
        }
    }
}
