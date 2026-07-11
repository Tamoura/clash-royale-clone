using ClashRoyale.Sim;
using UnityEngine;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Builds a chunky-cartoon character per card from primitives (body, head,
    /// eyes, limbs, and a class signifier), with outlines. Returns a root whose
    /// base sits at local y=0; the caller positions it on the board.
    /// </summary>
    public static class CharacterFactory
    {
        public static GameObject Build(CardId id, Side side, float radius, bool flying)
        {
            var root = new GameObject($"char-{id}");
            Color primary = Primary(id, side);
            Color dark = Shade(primary, 0.72f);
            Color light = Shade(primary, 1.18f);
            Color metal = new Color(0.72f, 0.75f, 0.82f);

            switch (id)
            {
                case CardId.Balloon:
                    BuildBalloon(root.transform, primary, dark, metal);
                    break;
                case CardId.BabyDragon:
                    BuildDragon(root.transform, primary, dark, light);
                    break;
                case CardId.Gargoyles:
                    BuildGargoyle(root.transform, primary, dark);
                    break;
                case CardId.Cannon:
                    BuildCannon(root.transform, primary, dark, metal);
                    break;
                case CardId.Tombstone:
                    BuildTombstone(root.transform, primary, dark);
                    break;
                case CardId.ElixirCollector:
                    BuildCollector(root.transform, primary, dark);
                    break;
                case CardId.Skeletons:
                    BuildHumanoid(root.transform, new Color(0.88f, 0.88f, 0.82f), new Color(0.6f, 0.6f, 0.55f),
                        Color.white, metal, Signifier.Bone, side);
                    break;
                case CardId.Giant:
                    BuildHumanoid(root.transform, primary, dark, light, metal, Signifier.Fist, side);
                    break;
                case CardId.Archers:
                case CardId.Musketeer:
                    BuildHumanoid(root.transform, primary, dark, light, metal, Signifier.Ranged, side);
                    break;
                case CardId.Wizard:
                case CardId.Witch:
                    BuildHumanoid(root.transform, primary, dark, light, metal, Signifier.Staff, side);
                    break;
                case CardId.HogRider:
                    BuildHogRider(root.transform, primary, dark, metal, side);
                    break;
                default:
                    BuildHumanoid(root.transform, primary, dark, light, metal, Signifier.Sword, side);
                    break;
            }

            // Slightly chunkier than the hitbox so troops read clearly at the
            // gameplay camera distance.
            float s = Mathf.Max(0.62f, radius / 0.5f) * 1.18f;
            root.transform.localScale = new Vector3(s, s, s);
            return root;
        }

        private enum Signifier { Sword, Fist, Ranged, Staff, Bone }

        // ---- humanoid ----------------------------------------------------

        private static void BuildHumanoid(Transform root, Color body, Color dark, Color light, Color metal, Signifier sig, Side side)
        {
            // legs
            Visuals.Part(PrimitiveType.Capsule, root, dark, new Vector3(-0.16f, 0.28f, 0), new Vector3(0.2f, 0.28f, 0.2f));
            Visuals.Part(PrimitiveType.Capsule, root, dark, new Vector3(0.16f, 0.28f, 0), new Vector3(0.2f, 0.28f, 0.2f));

            // torso
            Visuals.Part(PrimitiveType.Capsule, root, body, new Vector3(0, 0.74f, 0), new Vector3(0.52f, 0.34f, 0.42f));
            // team sash
            Visuals.Part(PrimitiveType.Cube, root, SideColor(side), new Vector3(0, 0.74f, 0.2f), new Vector3(0.5f, 0.16f, 0.06f), outline: false, emission: SideColor(side) * 0.25f);

            // head + eyes
            var head = Visuals.Part(PrimitiveType.Sphere, root, light, new Vector3(0, 1.16f, 0), new Vector3(0.5f, 0.5f, 0.5f));
            Eyes(head.transform);

            // arms
            Visuals.Part(PrimitiveType.Capsule, root, body, new Vector3(-0.36f, 0.84f, 0.04f), new Vector3(0.16f, 0.26f, 0.16f), Quaternion.Euler(0, 0, 18f));
            var rightArm = Visuals.Part(PrimitiveType.Capsule, root, body, new Vector3(0.36f, 0.84f, 0.08f), new Vector3(0.16f, 0.26f, 0.16f), Quaternion.Euler(20f, 0, -18f));

            AddSignifier(root, rightArm.transform, sig, dark, metal);
        }

        private static void AddSignifier(Transform root, Transform hand, Signifier sig, Color dark, Color metal)
        {
            switch (sig)
            {
                case Signifier.Sword:
                    Visuals.Part(PrimitiveType.Cube, root, metal, new Vector3(0.5f, 1.15f, 0.18f), new Vector3(0.09f, 0.95f, 0.09f), Quaternion.Euler(18f, 0, -8f), metallic: 0.6f, smoothness: 0.6f);
                    Visuals.Part(PrimitiveType.Cube, root, dark, new Vector3(0.5f, 0.7f, 0.18f), new Vector3(0.28f, 0.1f, 0.14f));
                    break;
                case Signifier.Fist:
                    Visuals.Part(PrimitiveType.Sphere, root, dark, new Vector3(0.5f, 0.62f, 0.12f), new Vector3(0.3f, 0.3f, 0.3f));
                    Visuals.Part(PrimitiveType.Sphere, root, dark, new Vector3(-0.5f, 0.62f, 0.12f), new Vector3(0.3f, 0.3f, 0.3f));
                    break;
                case Signifier.Ranged:
                    Visuals.Part(PrimitiveType.Cube, root, dark, new Vector3(0.42f, 0.95f, 0.34f), new Vector3(0.08f, 0.08f, 0.7f), Quaternion.Euler(8f, 0, 0));
                    break;
                case Signifier.Staff:
                    Visuals.Part(PrimitiveType.Cylinder, root, dark, new Vector3(0.5f, 1.0f, 0.14f), new Vector3(0.07f, 0.7f, 0.07f));
                    Visuals.Part(PrimitiveType.Sphere, root, new Color(0.4f, 0.85f, 1f), new Vector3(0.5f, 1.74f, 0.14f), new Vector3(0.26f, 0.26f, 0.26f), outline: false, emission: new Color(0.3f, 0.7f, 1f) * 1.6f);
                    break;
                case Signifier.Bone:
                    Visuals.Part(PrimitiveType.Cube, root, Color.white, new Vector3(0.46f, 0.9f, 0.16f), new Vector3(0.08f, 0.5f, 0.08f), Quaternion.Euler(0, 0, -20f));
                    break;
            }
        }

        private static void Eyes(Transform head)
        {
            Color black = new Color(0.06f, 0.07f, 0.1f);
            Visuals.Part(PrimitiveType.Sphere, head, black, new Vector3(-0.18f, 0.08f, 0.4f), new Vector3(0.16f, 0.16f, 0.12f), outline: false);
            Visuals.Part(PrimitiveType.Sphere, head, black, new Vector3(0.18f, 0.08f, 0.4f), new Vector3(0.16f, 0.16f, 0.12f), outline: false);
        }

        // ---- hog rider ---------------------------------------------------

        private static void BuildHogRider(Transform root, Color body, Color dark, Color metal, Side side)
        {
            // hog
            Visuals.Part(PrimitiveType.Capsule, root, new Color(0.45f, 0.32f, 0.26f), new Vector3(0, 0.5f, 0), new Vector3(0.6f, 0.5f, 0.6f), Quaternion.Euler(0, 0, 90f));
            Visuals.Part(PrimitiveType.Sphere, root, new Color(0.4f, 0.28f, 0.22f), new Vector3(0, 0.55f, 0.55f), new Vector3(0.45f, 0.42f, 0.42f));
            for (int i = 0; i < 4; i++)
            {
                float fx = (i % 2 == 0 ? -0.28f : 0.28f);
                float fz = (i < 2 ? 0.3f : -0.3f);
                Visuals.Part(PrimitiveType.Capsule, root, dark, new Vector3(fx, 0.18f, fz), new Vector3(0.16f, 0.18f, 0.16f));
            }

            // rider
            Visuals.Part(PrimitiveType.Capsule, root, body, new Vector3(0, 1.05f, -0.1f), new Vector3(0.42f, 0.3f, 0.36f));
            var head = Visuals.Part(PrimitiveType.Sphere, root, Shade(body, 1.2f), new Vector3(0, 1.5f, -0.1f), new Vector3(0.42f, 0.42f, 0.42f));
            Eyes(head.transform);
            // hammer
            Visuals.Part(PrimitiveType.Cylinder, root, new Color(0.4f, 0.3f, 0.22f), new Vector3(0.45f, 1.2f, 0.1f), new Vector3(0.08f, 0.5f, 0.08f), Quaternion.Euler(20f, 0, -10f));
            Visuals.Part(PrimitiveType.Cube, root, metal, new Vector3(0.55f, 1.7f, 0.1f), new Vector3(0.3f, 0.22f, 0.3f), metallic: 0.5f, smoothness: 0.5f);
        }

        // ---- flyers ------------------------------------------------------

        private static void BuildBalloon(Transform root, Color body, Color dark, Color metal)
        {
            Visuals.Part(PrimitiveType.Sphere, root, body, new Vector3(0, 1.3f, 0), new Vector3(1.1f, 1.3f, 1.1f), smoothness: 0.4f);
            Visuals.Part(PrimitiveType.Cube, root, new Color(0.45f, 0.32f, 0.22f), new Vector3(0, 0.5f, 0), new Vector3(0.55f, 0.4f, 0.55f));
            Visuals.Part(PrimitiveType.Sphere, root, new Color(0.12f, 0.12f, 0.14f), new Vector3(0, 0.2f, 0), new Vector3(0.5f, 0.5f, 0.5f), smoothness: 0.5f, emission: new Color(0.3f, 0.05f, 0.05f));
        }

        private static void BuildDragon(Transform root, Color body, Color dark, Color light)
        {
            Visuals.Part(PrimitiveType.Sphere, root, body, new Vector3(0, 0.7f, 0), new Vector3(0.9f, 0.85f, 1.0f));
            var head = Visuals.Part(PrimitiveType.Sphere, root, light, new Vector3(0, 1.25f, 0.3f), new Vector3(0.6f, 0.6f, 0.65f));
            Eyes(head.transform);
            Visuals.Part(PrimitiveType.Cube, root, dark, new Vector3(0, 1.18f, 0.62f), new Vector3(0.28f, 0.2f, 0.3f)); // snout
            // wings
            Visuals.Part(PrimitiveType.Cube, root, dark, new Vector3(-0.7f, 0.95f, -0.1f), new Vector3(0.6f, 0.06f, 0.5f), Quaternion.Euler(0, 0, 28f));
            Visuals.Part(PrimitiveType.Cube, root, dark, new Vector3(0.7f, 0.95f, -0.1f), new Vector3(0.6f, 0.06f, 0.5f), Quaternion.Euler(0, 0, -28f));
            Visuals.Part(PrimitiveType.Capsule, root, body, new Vector3(0, 0.55f, -0.7f), new Vector3(0.2f, 0.35f, 0.2f), Quaternion.Euler(50f, 0, 0)); // tail
        }

        private static void BuildGargoyle(Transform root, Color body, Color dark)
        {
            Visuals.Part(PrimitiveType.Capsule, root, body, new Vector3(0, 0.7f, 0), new Vector3(0.4f, 0.32f, 0.4f));
            var head = Visuals.Part(PrimitiveType.Sphere, root, body, new Vector3(0, 1.1f, 0.05f), new Vector3(0.42f, 0.42f, 0.42f));
            Eyes(head.transform);
            Visuals.Part(PrimitiveType.Cube, root, dark, new Vector3(-0.5f, 0.95f, -0.05f), new Vector3(0.5f, 0.05f, 0.4f), Quaternion.Euler(0, 0, 32f));
            Visuals.Part(PrimitiveType.Cube, root, dark, new Vector3(0.5f, 0.95f, -0.05f), new Vector3(0.5f, 0.05f, 0.4f), Quaternion.Euler(0, 0, -32f));
        }

        // ---- buildings ---------------------------------------------------

        private static void BuildCannon(Transform root, Color body, Color dark, Color metal)
        {
            Visuals.Part(PrimitiveType.Cube, root, new Color(0.5f, 0.38f, 0.26f), new Vector3(0, 0.3f, 0), new Vector3(1.0f, 0.6f, 1.0f));
            Visuals.Part(PrimitiveType.Cylinder, root, metal, new Vector3(0, 0.75f, 0.35f), new Vector3(0.28f, 0.5f, 0.28f), Quaternion.Euler(75f, 0, 0), metallic: 0.6f, smoothness: 0.5f);
        }

        private static void BuildTombstone(Transform root, Color body, Color dark)
        {
            Visuals.Part(PrimitiveType.Cube, root, new Color(0.6f, 0.62f, 0.66f), new Vector3(0, 0.6f, 0), new Vector3(0.8f, 1.1f, 0.3f));
            Visuals.Part(PrimitiveType.Cube, root, new Color(0.5f, 0.52f, 0.56f), new Vector3(0, 1.15f, 0), new Vector3(0.8f, 0.3f, 0.3f));
            Visuals.Part(PrimitiveType.Cube, root, new Color(0.35f, 0.4f, 0.3f), new Vector3(0, 0.1f, 0), new Vector3(1.2f, 0.2f, 0.9f));
        }

        private static void BuildCollector(Transform root, Color body, Color dark)
        {
            Visuals.Part(PrimitiveType.Cube, root, Shade(new Color(0.78f, 0.35f, 0.85f), 0.9f), new Vector3(0, 0.4f, 0), new Vector3(1.0f, 0.8f, 1.0f));
            Visuals.Part(PrimitiveType.Cylinder, root, new Color(0.85f, 0.4f, 0.9f), new Vector3(0, 1.0f, 0), new Vector3(0.5f, 0.35f, 0.5f), emission: new Color(0.5f, 0.1f, 0.6f) * 1.2f);
        }

        // ---- colour helpers ----------------------------------------------

        private static Color Primary(CardId id, Side side)
        {
            return Color.Lerp(CardVisual.ForCard(id), CardVisual.SideTint(side), 0.28f);
        }

        private static Color SideColor(Side side)
        {
            return side == Side.Player ? new Color(0.2f, 0.55f, 1f) : new Color(1f, 0.3f, 0.3f);
        }

        private static Color Shade(Color c, float f)
        {
            return new Color(Mathf.Clamp01(c.r * f), Mathf.Clamp01(c.g * f), Mathf.Clamp01(c.b * f), c.a);
        }
    }
}
