using System.Collections.Generic;
using ClashRoyale.Sim;
using UnityEngine;
using UnityEngine.Rendering;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Builds the dressed arena (lighting, tiled ground, crown towers, river and
    /// bridges) and keeps one outlined, multi-part character per sim entity in
    /// sync each frame, each with a billboarded HP bar.
    /// </summary>
    public sealed class GameView : MonoBehaviour
    {
        private const float W = (float)Arena.ArenaWidth;
        private const float H = (float)Arena.ArenaHeight;

        private sealed class EntityView
        {
            public GameObject Root;
            public Transform HpPivot;
            public Transform HpFill;
            public Renderer HpRenderer;
            public float TopY;
            public CharacterAnim Anim;
            public Vector3 LastPos;
            public bool HasLast;
        }

        private readonly Dictionary<int, EntityView> views = new();
        private Transform entityRoot;
        private GameObject deployZone;
        public Camera Camera { get; private set; }

        public void Build()
        {
            BuildCamera();
            BuildLighting();
            BuildBoard();
            BuildRiverAndBridges();
            BuildDeployZone();

            entityRoot = new GameObject("Entities").transform;
            entityRoot.SetParent(transform, false);
        }

        /// <summary>Translucent overlay on the player's half, shown while a card is selected.</summary>
        private void BuildDeployZone()
        {
            deployZone = GameObject.CreatePrimitive(PrimitiveType.Cube);
            deployZone.name = "DeployZone";
            Object.Destroy(deployZone.GetComponent<Collider>());
            deployZone.transform.SetParent(transform, false);
            // Player half is y in (RiverY, ArenaHeight] -> world z in [-H/2, 0).
            float zCenter = H / 2f - (float)((Arena.RiverY + Arena.ArenaHeight) / 2.0);
            float zLen = (float)(Arena.ArenaHeight - Arena.RiverY) - 1f;
            deployZone.transform.position = new Vector3(0f, 0.06f, zCenter);
            deployZone.transform.localScale = new Vector3(W - 0.5f, 0.04f, zLen);
            deployZone.GetComponent<Renderer>().sharedMaterial =
                Visuals.Transparent(new Color(0.35f, 0.7f, 1f, 0.16f));
            deployZone.SetActive(false);
        }

        public void SetDeployZone(bool visible)
        {
            if (deployZone != null)
            {
                deployZone.SetActive(visible);
            }
        }

        private void BuildCamera()
        {
            Camera = Camera.main;
            if (Camera == null)
            {
                var camGo = new GameObject("BattleCamera") { tag = "MainCamera" };
                Camera = camGo.AddComponent<Camera>();
            }

            Camera.clearFlags = CameraClearFlags.Skybox;
            Camera.orthographic = false;
            Camera.fieldOfView = 46f;
            // Angled portrait framing: top-down enough to read the board, tilted
            // enough that the real character models have presence.
            Camera.transform.position = new Vector3(0f, 33f, -19f);
            Camera.transform.LookAt(new Vector3(0f, 0f, -0.5f));
            Camera.allowHDR = true;
        }

        private void BuildLighting()
        {
            QualitySettings.shadows = ShadowQuality.All;
            QualitySettings.shadowResolution = ShadowResolution.VeryHigh;
            QualitySettings.shadowDistance = 90f;
            QualitySettings.antiAliasing = 4;

            // Gradient ambient gives soft, colourful fill in shadow.
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.55f, 0.62f, 0.78f);
            RenderSettings.ambientEquatorColor = new Color(0.42f, 0.45f, 0.5f);
            RenderSettings.ambientGroundColor = new Color(0.22f, 0.2f, 0.2f);

            // Subtle distance fog fades the far apron for depth.
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = new Color(0.55f, 0.66f, 0.85f);
            RenderSettings.fogStartDistance = 45f;
            RenderSettings.fogEndDistance = 110f;

            // Procedural sky.
            Shader skyShader = Shader.Find("Skybox/Procedural");
            if (skyShader != null)
            {
                var sky = new Material(skyShader);
                sky.SetFloat("_AtmosphereThickness", 0.9f);
                sky.SetColor("_SkyTint", new Color(0.5f, 0.65f, 0.9f));
                sky.SetColor("_GroundColor", new Color(0.3f, 0.32f, 0.36f));
                sky.SetFloat("_Exposure", 1.05f);
                RenderSettings.skybox = sky;
            }

            // Key light (warm, casts shadows).
            var keyGo = new GameObject("KeyLight");
            Light key = keyGo.AddComponent<Light>();
            key.type = LightType.Directional;
            key.color = new Color(1f, 0.96f, 0.88f);
            key.intensity = 1.15f;
            key.shadows = LightShadows.Soft;
            key.shadowStrength = 0.55f;
            keyGo.transform.rotation = Quaternion.Euler(52f, -35f, 0f);
            RenderSettings.sun = key;

            // Cool fill, no shadows.
            var fillGo = new GameObject("FillLight");
            Light fill = fillGo.AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.color = new Color(0.6f, 0.72f, 0.95f);
            fill.intensity = 0.4f;
            fill.shadows = LightShadows.None;
            fillGo.transform.rotation = Quaternion.Euler(40f, 150f, 0f);
        }

        private void BuildBoard()
        {
            // Two-tone tiled lanes so the arena reads like a board.
            Texture2D tile = Visuals.StoneTile(new Color(0.82f, 0.74f, 0.55f), new Color(0.62f, 0.54f, 0.4f));

            GameObject board = MakeQuadCube("Board", new Color(0.85f, 0.78f, 0.6f),
                new Vector3(0f, -0.1f, 0f), new Vector3(W, 0.2f, H));
            var br = board.GetComponent<Renderer>();
            br.sharedMaterial.mainTexture = tile;
            br.sharedMaterial.mainTextureScale = new Vector2(W / 2f, H / 2f);

            // Grass apron around the board.
            GameObject apron = MakeQuadCube("Apron", new Color(0.28f, 0.45f, 0.26f),
                new Vector3(0f, -0.25f, 0f), new Vector3(W + 6f, 0.25f, H + 6f));
            apron.GetComponent<Renderer>().sharedMaterial.SetFloat("_Glossiness", 0.05f);

            // Low stone border walls.
            Color wall = new Color(0.55f, 0.5f, 0.46f);
            MakeWall(new Vector3(-(W / 2f) - 0.4f, 0.3f, 0f), new Vector3(0.8f, 0.9f, H), wall);
            MakeWall(new Vector3((W / 2f) + 0.4f, 0.3f, 0f), new Vector3(0.8f, 0.9f, H), wall);

            // Faint centre-line emblem per side.
            EmblemRing(new Vector3(0f, 0.02f, -8f), new Color(0.95f, 0.85f, 0.35f));
            EmblemRing(new Vector3(0f, 0.02f, 8f), new Color(0.95f, 0.85f, 0.35f));
        }

        private void MakeWall(Vector3 pos, Vector3 scale, Color color)
        {
            GameObject w = MakeQuadCube("Wall", color, pos, scale);
            w.GetComponent<Renderer>().sharedMaterial.SetFloat("_Glossiness", 0.08f);
        }

        private void EmblemRing(Vector3 center, Color color)
        {
            var ring = Visuals.Part(PrimitiveType.Cylinder, transform, color,
                center + Vector3.up * 0.02f, new Vector3(3.2f, 0.02f, 3.2f), outline: false,
                emission: color * 0.15f);
            ring.GetComponent<Renderer>().sharedMaterial.SetFloat("_Glossiness", 0.2f);
        }

        private void BuildRiverAndBridges()
        {
            GameObject river = MakeQuadCube("River", new Color(0.22f, 0.55f, 0.85f),
                new Vector3(0f, 0.02f, H / 2f - (float)Arena.RiverY),
                new Vector3(W, 0.08f, (float)(Arena.RiverHalfWidth * 2)));
            var rr = river.GetComponent<Renderer>();
            rr.sharedMaterial.SetFloat("_Glossiness", 0.85f);
            rr.sharedMaterial.SetColor("_EmissionColor", new Color(0.05f, 0.15f, 0.3f));
            rr.sharedMaterial.EnableKeyword("_EMISSION");

            foreach (double bx in Arena.BridgeXs)
            {
                var bridge = MakeQuadCube("Bridge", new Color(0.62f, 0.45f, 0.26f),
                    new Vector3((float)bx - W / 2f, 0.08f, H / 2f - (float)Arena.RiverY),
                    new Vector3((float)(Arena.BridgeHalfWidth * 2) + 0.4f, 0.16f, 2.8f));
                // plank slats
                for (int i = -2; i <= 2; i++)
                {
                    Visuals.Part(PrimitiveType.Cube, bridge.transform, new Color(0.5f, 0.36f, 0.2f),
                        new Vector3(0f, 0.55f, i * 0.34f), new Vector3(1.02f, 0.2f, 0.12f), outline: false);
                }
            }
        }

        /// <summary>World position for a sim tile coordinate.</summary>
        public static Vector3 WorldPos(double x, double y, float elevation)
        {
            return new Vector3((float)x - W / 2f, elevation, H / 2f - (float)y);
        }

        /// <summary>Sim tile coordinate for a world point.</summary>
        public static Vector2 SimFromWorld(Vector3 p)
        {
            return new Vector2(p.x + W / 2f, H / 2f - p.z);
        }

        public void Sync(BattleState state)
        {
            var live = new HashSet<int>();
            foreach (Entity e in state.Entities)
            {
                live.Add(e.Id);
                if (!views.TryGetValue(e.Id, out EntityView view))
                {
                    view = CreateView(e);
                    views[e.Id] = view;
                }

                float elevation = e.Flying ? 1.7f : 0f;
                Vector3 pos = WorldPos(e.X, e.Y, elevation);
                Vector3 prev = view.HasLast ? view.LastPos : pos;
                view.Root.transform.position = pos;

                if (e.Kind == EntityKind.Troop)
                {
                    Vector3 delta = pos - prev;
                    delta.y = 0f;
                    bool moving = delta.sqrMagnitude > 0.0000004f; // ~moved this frame
                    Vector3 faceDir = moving
                        ? delta.normalized
                        : new Vector3(0, 0, e.Side == Side.Player ? 1f : -1f);
                    view.Root.transform.rotation = Quaternion.Slerp(
                        view.Root.transform.rotation, Quaternion.LookRotation(faceDir), 0.25f);

                    view.Anim?.Play(moving ? "Walking_A" : "Idle");
                }

                view.LastPos = pos;
                view.HasLast = true;
                UpdateHpBar(view, e, elevation);
            }

            var dead = new List<int>();
            foreach (int id in views.Keys)
            {
                if (!live.Contains(id))
                {
                    dead.Add(id);
                }
            }

            foreach (int id in dead)
            {
                Object.Destroy(views[id].Root);
                if (views[id].HpPivot != null)
                {
                    Object.Destroy(views[id].HpPivot.gameObject);
                }

                views.Remove(id);
            }
        }

        private EntityView CreateView(Entity e)
        {
            GameObject root;
            float topY;
            CharacterAnim anim = null;

            if (e.Kind == EntityKind.PrincessTower || e.Kind == EntityKind.KingTower)
            {
                root = TowerFactory.Build(e.Kind, e.Side, (float)e.Radius);
                topY = e.Kind == EntityKind.KingTower ? 3.6f : 2.8f;
            }
            else if (e.Kind == EntityKind.Troop &&
                     KayKitModels.TryBuild(e.CardId.Value, e.Side, (float)e.Radius, out GameObject model, out anim))
            {
                root = model;
                topY = 2.2f * Mathf.Max(0.7f, (float)e.Radius / 0.5f);
            }
            else
            {
                root = CharacterFactory.Build(e.CardId.Value, e.Side, (float)e.Radius, e.Flying);
                topY = 2.0f * Mathf.Max(0.5f, (float)e.Radius / 0.5f);
            }

            root.transform.SetParent(entityRoot, false);

            EntityView view = new EntityView { Root = root, TopY = topY, Anim = anim };
            BuildHpBar(view, e);
            return view;
        }

        private void BuildHpBar(EntityView view, Entity e)
        {
            var pivot = new GameObject("hp").transform;
            pivot.SetParent(entityRoot, false);

            // background
            var bg = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Object.Destroy(bg.GetComponent<Collider>());
            bg.transform.SetParent(pivot, false);
            bg.transform.localScale = new Vector3(1.3f, 0.22f, 1f);
            bg.GetComponent<Renderer>().sharedMaterial = Visuals.Lit(new Color(0.08f, 0.09f, 0.12f), 0f);
            bg.GetComponent<Renderer>().shadowCastingMode = ShadowCastingMode.Off;

            // fill, left-anchored via an offset child
            var fillPivot = new GameObject("fillPivot").transform;
            fillPivot.SetParent(pivot, false);
            fillPivot.localPosition = new Vector3(-0.62f, 0f, -0.01f);

            var fill = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Object.Destroy(fill.GetComponent<Collider>());
            fill.transform.SetParent(fillPivot, false);
            fill.transform.localScale = new Vector3(1.24f, 0.16f, 1f);
            fill.transform.localPosition = new Vector3(0.62f, 0f, 0f);
            Color hpCol = e.Side == Side.Player ? new Color(0.3f, 0.85f, 0.35f) : new Color(0.9f, 0.3f, 0.3f);
            var fr = fill.GetComponent<Renderer>();
            fr.sharedMaterial = Visuals.Lit(hpCol, 0f, 0f, hpCol * 0.4f);
            fr.shadowCastingMode = ShadowCastingMode.Off;

            view.HpPivot = pivot;
            view.HpFill = fillPivot;
            view.HpRenderer = fr;
        }

        private void UpdateHpBar(EntityView view, Entity e, float elevation)
        {
            if (view.HpPivot == null)
            {
                return;
            }

            float frac = Mathf.Clamp01((float)(e.Hp / e.MaxHp));
            bool full = frac >= 0.999f;
            view.HpPivot.gameObject.SetActive(!full);
            if (full)
            {
                return;
            }

            view.HpPivot.position = WorldPos(e.X, e.Y, elevation) + Vector3.up * view.TopY;
            view.HpPivot.rotation = Camera.transform.rotation; // billboard
            view.HpFill.localScale = new Vector3(frac, 1f, 1f);
        }

        // ---- small builders ----------------------------------------------

        private GameObject MakeQuadCube(string name, Color color, Vector3 pos, Vector3 scale)
        {
            GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            Object.Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(transform, false);
            go.transform.position = pos;
            go.transform.localScale = scale;
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = Visuals.Lit(color, 0.1f);
            r.receiveShadows = true;
            return go;
        }
    }
}
