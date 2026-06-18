using System.Collections.Generic;
using ClashRoyale.Sim;
using UnityEngine;
using UnityEngine.Rendering;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Instantiates real rigged KayKit (CC0) character models loaded from
    /// Resources, applies their texture, and attaches a <see cref="CharacterAnim"/>.
    /// Cards without a model fall back to the primitive <see cref="CharacterFactory"/>.
    /// </summary>
    public static class KayKitModels
    {
        private static readonly Dictionary<string, Dictionary<string, AnimationClip>> ClipCache = new();

        /// <summary>Approx height (model units) so we can scale to the board.</summary>
        private const float ModelHeight = 1.8f;

        public static bool TryBuild(CardId id, Side side, float radius, out GameObject root, out CharacterAnim anim)
        {
            root = null;
            anim = null;

            string model = MapModel(id);
            if (model == null)
            {
                return false;
            }

            var prefab = Resources.Load<GameObject>($"KayKit/{model}");
            if (prefab == null)
            {
                return false;
            }

            root = Object.Instantiate(prefab);
            root.name = $"kaykit-{model}";

            // One lit material from the character's texture atlas, tinted by side.
            var tex = Resources.Load<Texture2D>($"KayKit/{model.ToLowerInvariant()}_texture");
            Color tint = Color.Lerp(Color.white, CardVisual.SideTint(side), 0.18f);
            Material mat = Visuals.Lit(tint, 0.12f);
            if (tex != null)
            {
                mat.mainTexture = tex;
            }

            foreach (Renderer r in root.GetComponentsInChildren<Renderer>())
            {
                r.sharedMaterial = mat;
                r.shadowCastingMode = ShadowCastingMode.On;
                r.receiveShadows = true;
            }

            if (!ClipCache.TryGetValue(model, out Dictionary<string, AnimationClip> clips))
            {
                clips = new Dictionary<string, AnimationClip>();
                foreach (AnimationClip c in Resources.LoadAll<AnimationClip>($"KayKit/{model}"))
                {
                    clips[c.name] = c;
                }

                ClipCache[model] = clips;
            }

            Animator animator = root.GetComponentInChildren<Animator>();
            if (animator == null)
            {
                animator = root.AddComponent<Animator>();
            }

            anim = root.AddComponent<CharacterAnim>();
            anim.Init(animator, clips, "Idle");

            // Scale the ~1.8u model to the unit's board footprint.
            float target = 1.5f * Mathf.Max(0.7f, radius / 0.5f);
            float s = target / ModelHeight;
            root.transform.localScale = new Vector3(s, s, s);
            return true;
        }

        private static string MapModel(CardId id)
        {
            return id switch
            {
                CardId.Knight => "Knight",
                CardId.Prince => "Knight",
                CardId.Pekka => "Knight",
                CardId.MiniPekka => "Barbarian",
                CardId.Valkyrie => "Barbarian",
                CardId.Giant => "Barbarian",
                CardId.Wizard => "Mage",
                CardId.Witch => "Mage",
                CardId.Archers => "Rogue",
                CardId.Musketeer => "Rogue",
                CardId.Skeletons => "Skeleton",
                _ => null, // hog-rider, flyers, buildings -> primitive factory
            };
        }
    }
}
