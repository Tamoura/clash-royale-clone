using ClashRoyale.Sim;
using UnityEngine;

namespace ClashRoyale.Game
{
    /// <summary>Structured stone crown towers with battlements and a side-coloured roof.</summary>
    public static class TowerFactory
    {
        private static readonly Color Stone = new Color(0.72f, 0.69f, 0.62f);
        private static readonly Color StoneDark = new Color(0.55f, 0.52f, 0.46f);

        public static GameObject Build(EntityKind kind, Side side, float radius)
        {
            var root = new GameObject($"tower-{kind}");
            Color accent = side == Side.Player ? new Color(0.25f, 0.55f, 1f) : new Color(1f, 0.32f, 0.32f);
            bool king = kind == EntityKind.KingTower;

            float w = king ? 2.6f : 2.0f;
            float bodyH = king ? 2.2f : 1.7f;

            // Plinth + body.
            Visuals.Part(PrimitiveType.Cube, root.transform, StoneDark, new Vector3(0, 0.25f, 0), new Vector3(w + 0.5f, 0.5f, w + 0.5f));
            Visuals.Part(PrimitiveType.Cube, root.transform, Stone, new Vector3(0, 0.5f + bodyH / 2f, 0), new Vector3(w, bodyH, w));

            // Battlements around the top.
            float top = 0.5f + bodyH;
            float half = w / 2f - 0.2f;
            for (int i = 0; i < 4; i++)
            {
                float s = (i % 2 == 0) ? -half : half;
                float a = (i < 2) ? -half : half;
                Visuals.Part(PrimitiveType.Cube, root.transform, StoneDark, new Vector3(s, top + 0.2f, a), new Vector3(0.45f, 0.5f, 0.45f));
                Visuals.Part(PrimitiveType.Cube, root.transform, StoneDark, new Vector3(a, top + 0.2f, s), new Vector3(0.45f, 0.5f, 0.45f));
            }

            // Side-coloured roof + accent band.
            Visuals.Part(PrimitiveType.Cube, root.transform, accent, new Vector3(0, top + 0.05f, 0), new Vector3(w - 0.3f, 0.25f, w - 0.3f),
                emission: accent * 0.2f);

            if (king)
            {
                // central keep + golden crown.
                Visuals.Part(PrimitiveType.Cube, root.transform, accent, new Vector3(0, top + 0.7f, 0), new Vector3(1.1f, 1.0f, 1.1f), emission: accent * 0.2f);
                Color gold = new Color(1f, 0.82f, 0.3f);
                for (int i = 0; i < 4; i++)
                {
                    float ang = i * Mathf.PI / 2f;
                    Visuals.Part(PrimitiveType.Cube, root.transform, gold,
                        new Vector3(Mathf.Cos(ang) * 0.4f, top + 1.4f, Mathf.Sin(ang) * 0.4f),
                        new Vector3(0.16f, 0.4f, 0.16f), emission: gold * 0.5f, smoothness: 0.6f, metallic: 0.5f);
                }

                Visuals.Part(PrimitiveType.Cylinder, root.transform, gold, new Vector3(0, top + 1.2f, 0), new Vector3(0.5f, 0.12f, 0.5f),
                    emission: gold * 0.5f, smoothness: 0.6f, metallic: 0.5f);
            }
            else
            {
                // princess turret cap.
                Visuals.Part(PrimitiveType.Cylinder, root.transform, accent, new Vector3(0, top + 0.5f, 0), new Vector3(0.9f, 0.4f, 0.9f), emission: accent * 0.2f);
                Visuals.Part(PrimitiveType.Sphere, root.transform, new Color(1f, 0.82f, 0.3f), new Vector3(0, top + 1.0f, 0), new Vector3(0.3f, 0.3f, 0.3f),
                    emission: new Color(1f, 0.82f, 0.3f) * 0.5f, smoothness: 0.6f);
            }

            float s2 = radius / 1.0f;
            root.transform.localScale = new Vector3(s2, s2, s2);
            return root;
        }
    }
}
