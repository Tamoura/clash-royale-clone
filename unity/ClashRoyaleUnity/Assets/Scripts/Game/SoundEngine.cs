using System;
using System.Collections.Generic;
using ClashRoyale.Sim;
using UnityEngine;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Procedurally-synthesized SFX (no audio assets), mirroring the web build's
    /// Web Audio approach. Clips are generated once; sim events trigger them.
    /// </summary>
    public sealed class SoundEngine : MonoBehaviour
    {
        private const int SampleRate = 44100;

        private AudioSource src;
        private AudioClip deploy, hit, boom, pop, chime, horn, fanfare;
        private float lastHit, lastPop;

        public void Init()
        {
            src = gameObject.AddComponent<AudioSource>();
            src.playOnAwake = false;
            src.spatialBlend = 0f;

            deploy = Make("deploy", 0.22f, t =>
                Noise() * Mathf.Exp(-t * 16f) * 0.5f + Sine(170f, t) * Mathf.Exp(-t * 9f) * 0.5f);
            hit = Make("hit", 0.08f, t =>
                Sine(880f, t) * Mathf.Exp(-t * 38f) * 0.6f + Noise() * Mathf.Exp(-t * 70f) * 0.4f);
            boom = Make("boom", 0.5f, t =>
                Sine(90f, t) * Mathf.Exp(-t * 5f) * 0.7f + Noise() * Mathf.Exp(-t * 7f) * 0.4f);
            pop = Make("pop", 0.14f, t =>
                Sine(Mathf.Lerp(420f, 160f, t / 0.14f), t) * Mathf.Exp(-t * 22f) * 0.6f);
            chime = Make("chime", 0.5f, t =>
                (Sine(660f, t) + Sine(990f, t) * (t > 0.12f ? 1f : 0f)) * Mathf.Exp(-t * 5f) * 0.4f);
            horn = Make("horn", 0.6f, t =>
                Saw(120f, t) * Mathf.Exp(-t * 3f) * 0.5f);
            fanfare = Make("fanfare", 0.8f, t =>
            {
                float f = t < 0.27f ? 523f : t < 0.54f ? 659f : 784f;
                return Sine(f, t) * Mathf.Exp(-(t % 0.27f) * 6f) * 0.4f;
            });
        }

        public void Handle(List<BattleEvent> events)
        {
            if (src == null)
            {
                return;
            }

            foreach (BattleEvent e in events)
            {
                switch (e)
                {
                    case DeployEvent:
                        Play(deploy, 0.5f);
                        break;
                    case SpellEvent:
                        Play(boom, 0.6f);
                        break;
                    case AttackEvent:
                        if (Time.time - lastHit > 0.06f)
                        {
                            Play(hit, 0.22f);
                            lastHit = Time.time;
                        }

                        break;
                    case DeathEvent:
                        if (Time.time - lastPop > 0.05f)
                        {
                            Play(pop, 0.4f);
                            lastPop = Time.time;
                        }

                        break;
                    case CrownEvent:
                        Play(chime, 0.7f);
                        break;
                    case KingWakeEvent:
                        Play(horn, 0.7f);
                        break;
                    case FinishEvent:
                        Play(fanfare, 0.85f);
                        break;
                }
            }
        }

        private void Play(AudioClip clip, float volume)
        {
            if (clip != null)
            {
                src.PlayOneShot(clip, volume);
            }
        }

        // ---- synthesis ----------------------------------------------------

        private static float Sine(float freq, float t)
        {
            return Mathf.Sin(2f * Mathf.PI * freq * t);
        }

        private static float Saw(float freq, float t)
        {
            float p = freq * t;
            return 2f * (p - Mathf.Floor(p + 0.5f));
        }

        private static float Noise()
        {
            return UnityEngine.Random.value * 2f - 1f;
        }

        private static AudioClip Make(string name, float dur, Func<float, float> wave)
        {
            int n = Mathf.Max(1, (int)(SampleRate * dur));
            var data = new float[n];
            for (int i = 0; i < n; i++)
            {
                float t = (float)i / SampleRate;
                data[i] = Mathf.Clamp(wave(t), -1f, 1f);
            }

            var clip = AudioClip.Create(name, n, 1, SampleRate, false);
            clip.SetData(data, 0);
            return clip;
        }
    }
}
