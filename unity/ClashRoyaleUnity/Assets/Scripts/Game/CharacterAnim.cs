using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Plays named animation clips on a rigged model via a small PlayableGraph,
    /// crossfading between the current and next clip. No AnimatorController asset
    /// needed, so it works from runtime-loaded models (KayKit FBX clips).
    /// </summary>
    public sealed class CharacterAnim : MonoBehaviour
    {
        private PlayableGraph graph;
        private AnimationMixerPlayable mixer;
        private readonly AnimationClipPlayable[] inputs = new AnimationClipPlayable[2];
        private Dictionary<string, AnimationClip> clips;
        private int active;
        private float weight; // weight of the active input
        private const float Blend = 0.18f;
        private string current;

        public void Init(Animator animator, Dictionary<string, AnimationClip> clipMap, string start)
        {
            clips = clipMap;
            graph = PlayableGraph.Create("CharAnim-" + GetInstanceID());
            graph.SetTimeUpdateMode(DirectorUpdateMode.GameTime);
            var output = AnimationPlayableOutput.Create(graph, "out", animator);
            mixer = AnimationMixerPlayable.Create(graph, 2);
            output.SetSourcePlayable(mixer);

            active = 0;
            weight = 1f;
            inputs[0] = AnimationClipPlayable.Create(graph, Resolve(start));
            mixer.ConnectInput(0, inputs[0], 0);
            mixer.SetInputWeight(0, 1f);
            current = start;
            graph.Play();
        }

        private AnimationClip Resolve(string name)
        {
            if (clips != null && clips.TryGetValue(name, out AnimationClip c))
            {
                return c;
            }

            // Fall back to any clip so the graph is always valid.
            foreach (var kv in clips)
            {
                return kv.Value;
            }

            return null;
        }

        public void Play(string name)
        {
            if (name == current || clips == null || !clips.ContainsKey(name) || !graph.IsValid())
            {
                return;
            }

            current = name;
            int other = 1 - active;
            if (inputs[other].IsValid())
            {
                mixer.DisconnectInput(other);
                inputs[other].Destroy();
            }

            inputs[other] = AnimationClipPlayable.Create(graph, clips[name]);
            mixer.ConnectInput(other, inputs[other], 0);
            active = other;
            weight = 0f; // blend up from 0
        }

        private void Update()
        {
            if (!graph.IsValid())
            {
                return;
            }

            weight = Mathf.MoveTowards(weight, 1f, Time.deltaTime / Blend);
            mixer.SetInputWeight(active, weight);
            mixer.SetInputWeight(1 - active, 1f - weight);
        }

        private void OnDestroy()
        {
            if (graph.IsValid())
            {
                graph.Destroy();
            }
        }
    }
}
