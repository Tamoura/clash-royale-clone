using System.Collections.Generic;
using ClashRoyale.Sim;
using UnityEngine;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Builds the static arena and keeps one primitive GameObject per sim
    /// entity in sync each frame. Pure presentation — it never mutates the sim.
    /// </summary>
    public sealed class GameView : MonoBehaviour
    {
        private const float W = (float)Arena.ArenaWidth;
        private const float H = (float)Arena.ArenaHeight;

        private readonly Dictionary<int, GameObject> views = new();
        private Transform entityRoot;
        public Camera Camera { get; private set; }

        public void Build()
        {
            BuildCamera();
            BuildLight();
            BuildBoard();
            BuildRiverAndBridges();

            entityRoot = new GameObject("Entities").transform;
            entityRoot.SetParent(transform, false);
        }

        private void BuildCamera()
        {
            // Reuse a camera the scene already has; otherwise make our own.
            Camera = Camera.main;
            if (Camera == null)
            {
                var camGo = new GameObject("BattleCamera");
                camGo.tag = "MainCamera";
                Camera = camGo.AddComponent<Camera>();
            }

            Camera.backgroundColor = new Color(0.04f, 0.07f, 0.13f);
            Camera.clearFlags = CameraClearFlags.SolidColor;
            Camera.orthographic = false;
            Camera.fieldOfView = 40f;
            Camera.transform.position = new Vector3(0f, 28f, -22f);
            Camera.transform.LookAt(new Vector3(0f, 0f, 1.5f));
        }

        private static void BuildLight()
        {
            if (Object.FindObjectOfType<Light>() != null)
            {
                return; // the scene already lights itself
            }

            var lightGo = new GameObject("Sun");
            Light light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.1f;
            light.color = new Color(1f, 0.97f, 0.9f);
            lightGo.transform.rotation = Quaternion.Euler(55f, -25f, 0f);
        }

        private void BuildBoard()
        {
            GameObject board = Solid(PrimitiveType.Cube, "Board", new Color(0.18f, 0.42f, 0.22f));
            board.transform.SetParent(transform, false);
            board.transform.position = new Vector3(0f, -0.1f, 0f);
            board.transform.localScale = new Vector3(W, 0.2f, H);
            // The board's BoxCollider is the raycast target for deploy taps.
        }

        private void BuildRiverAndBridges()
        {
            GameObject river = Solid(PrimitiveType.Cube, "River", new Color(0.20f, 0.50f, 0.78f));
            river.transform.SetParent(transform, false);
            river.transform.position = new Vector3(0f, 0.02f, H / 2f - (float)Arena.RiverY);
            river.transform.localScale = new Vector3(W, 0.06f, (float)(Arena.RiverHalfWidth * 2));
            Object.Destroy(river.GetComponent<Collider>());

            foreach (double bx in Arena.BridgeXs)
            {
                GameObject bridge = Solid(PrimitiveType.Cube, "Bridge", new Color(0.78f, 0.62f, 0.30f));
                bridge.transform.SetParent(transform, false);
                bridge.transform.position = new Vector3((float)bx - W / 2f, 0.05f, H / 2f - (float)Arena.RiverY);
                bridge.transform.localScale = new Vector3((float)(Arena.BridgeHalfWidth * 2), 0.1f, 2.4f);
                Object.Destroy(bridge.GetComponent<Collider>());
            }
        }

        /// <summary>World position for a sim tile coordinate.</summary>
        public static Vector3 WorldPos(double x, double y, float elevation)
        {
            return new Vector3((float)x - W / 2f, elevation, H / 2f - (float)y);
        }

        /// <summary>Sim tile coordinate for a world point (from a ground raycast).</summary>
        public static Vector2 SimFromWorld(Vector3 p)
        {
            return new Vector2(p.x + W / 2f, H / 2f - p.z);
        }

        /// <summary>Reconcile the GameObject pool with the current entity list.</summary>
        public void Sync(BattleState state)
        {
            var live = new HashSet<int>();
            foreach (Entity e in state.Entities)
            {
                live.Add(e.Id);
                if (!views.TryGetValue(e.Id, out GameObject go))
                {
                    go = CreateView(e);
                    views[e.Id] = go;
                }

                float elevation = e.Flying ? 1.6f : (float)e.Radius;
                go.transform.position = WorldPos(e.X, e.Y, elevation);
            }

            // Remove views whose entities have died.
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
                Object.Destroy(views[id]);
                views.Remove(id);
            }
        }

        private GameObject CreateView(Entity e)
        {
            Color color;
            PrimitiveType shape;
            float scale = (float)e.Radius * 2f;

            switch (e.Kind)
            {
                case EntityKind.PrincessTower:
                case EntityKind.KingTower:
                    shape = PrimitiveType.Cube;
                    color = e.Side == Side.Player ? CardVisual.PlayerTower : CardVisual.EnemyTower;
                    scale = (float)e.Radius * 2.4f;
                    break;
                case EntityKind.Building:
                    shape = PrimitiveType.Cube;
                    color = Tint(e);
                    break;
                default:
                    shape = e.Flying ? PrimitiveType.Sphere : PrimitiveType.Capsule;
                    color = Tint(e);
                    break;
            }

            GameObject go = Solid(shape, $"E{e.Id}", color);
            go.transform.SetParent(entityRoot, false);
            float height = e.Kind == EntityKind.KingTower || e.Kind == EntityKind.PrincessTower ? scale * 1.6f : scale;
            go.transform.localScale = new Vector3(scale, height, scale);
            Object.Destroy(go.GetComponent<Collider>());
            return go;
        }

        /// <summary>Card hue blended toward the owning side's tint.</summary>
        private static Color Tint(Entity e)
        {
            Color baseColor = e.CardId.HasValue ? CardVisual.ForCard(e.CardId.Value) : Color.gray;
            return Color.Lerp(baseColor, CardVisual.SideTint(e.Side), 0.35f);
        }

        private static GameObject Solid(PrimitiveType type, string name, Color color)
        {
            GameObject go = GameObject.CreatePrimitive(type);
            go.name = name;
            var renderer = go.GetComponent<Renderer>();
            renderer.material.color = color;
            return go;
        }
    }
}
