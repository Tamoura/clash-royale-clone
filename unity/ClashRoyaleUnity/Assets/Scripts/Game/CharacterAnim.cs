using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Plays named clips on a rigged model via a small PlayableGraph, crossfading
    /// between the current and next clip. Loops the active clip manually (so it
    /// works whether or not the imported clip has Loop Time set); one-shot clips
    /// (attack/death) play once and hold. No AnimatorController asset needed.
    /// </summary>
    public sealed class CharacterAnim : MonoBehaviour
    {
        private PlayableGraph graph;
        private AnimationMixerPlayable mixer;
        private readonly AnimationClipPlayable[] inputs = new AnimationClipPlayable[2];
        private Dictionary<string, AnimationClip> clips;
        private int active;
        private float weight;
        private string current;
        private bool loop;
        private float length;
        private const float Blend = 0.15f;

        public void Init(Animator animator, Dictionary<string, AnimationClip> clipMap, string start)
        {
            clips = clipMap;
            graph = PlayableGraph.Create("CharAnim-" + GetInstanceID());
            graph.SetTimeUpdateMode(DirectorUpdateMode.GameTime);
            var output = AnimationPlayableOutput.Create(graph, "out", animator);
            mixer = AnimationMixerPlayable.Create(graph, 2);
            output.SetSourcePlayable(mixer);

            AnimationClip clip = Resolve(start);
            active = 0;
            weight = 1f;
            loop = true;
            length = clip != null ? Mathf.Max(0.05f, clip.length) : 1f;
            inputs[0] = AnimationClipPlayable.Create(graph, clip);
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

            foreach (var kv in clips)
            {
                return kv.Value;
            }

            return null;
        }

        public void Play(string name, bool looping = true)
        {
            if (name == current || clips == null || !clips.ContainsKey(name) || !graph.IsValid())
            {
                return;
            }

            current = name;
            loop = looping;
            length = Mathf.Max(0.05f, clips[name].length);

            int other = 1 - active;
            if (inputs[other].IsValid())
            {
                mixer.DisconnectInput(other);
                inputs[other].Destroy();
            }

            inputs[other] = AnimationClipPlayable.Create(graph, clips[name]);
            inputs[other].SetTime(0);
            mixer.ConnectInput(other, inputs[other], 0);
            active = other;
            weight = 0f;
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

            if (loop && inputs[active].IsValid())
            {
                double t = inputs[active].GetTime();
                if (t >= length)
                {
                    inputs[active].SetTime(t - length);
                }
            }
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
