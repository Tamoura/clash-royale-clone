using System;
using System.Collections.Generic;
using ClashRoyale.Sim;
using UnityEngine;
using UnityEngine.EventSystems;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Entry point for the Unity edition. Auto-runs on play via
    /// <see cref="RuntimeInitializeOnLoadMethod"/>, so the battle works from an
    /// empty scene with no manual wiring. Owns the deterministic sim and drives
    /// it at a fixed timestep, mirroring the web build's main loop.
    /// </summary>
    public sealed class Bootstrap : MonoBehaviour
    {
        private const double FixedDt = 1.0 / 30.0;
        private const double MaxFrame = 0.25;

        private BattleState state;
        private BotState bot;
        private GameView view;
        private BattleHud hud;
        private double accumulator;
        private bool finished;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Launch()
        {
            var go = new GameObject("ClashRoyale");
            DontDestroyOnLoad(go);
            go.AddComponent<Bootstrap>();
        }

        private void Awake()
        {
            EnsureEventSystem();

            view = gameObject.AddComponent<GameView>();
            view.Build();

            hud = gameObject.AddComponent<BattleHud>();
            hud.Build(Restart);

            StartBattle();
        }

        /// <summary>uGUI buttons need an EventSystem to receive clicks.</summary>
        private static void EnsureEventSystem()
        {
            if (EventSystem.current != null)
            {
                return;
            }

            var es = new GameObject("EventSystem");
            es.AddComponent<EventSystem>();
            es.AddComponent<StandaloneInputModule>();
            DontDestroyOnLoad(es);
        }

        private void StartBattle()
        {
            state = Battle.CreateBattle(PlayerDeck(), RandomDeck());
            bot = Bot.CreateBot(unchecked((uint)Environment.TickCount));
            accumulator = 0;
            finished = false;
            hud.HideResult();
            hud.ClearSelection();
        }

        private void Restart()
        {
            StartBattle();
        }

        /// <summary>
        /// The player's deck, taken from a <c>?deck=knight,archers,...</c> URL
        /// param the web build passes through (so the Unity edition uses the same
        /// 8 cards you picked); falls back to the default deck.
        /// </summary>
        private static List<CardId> PlayerDeck()
        {
            string slugs = QueryParam("deck");
            if (!string.IsNullOrEmpty(slugs))
            {
                var deck = new List<CardId>();
                foreach (string slug in slugs.Split(','))
                {
                    if (Cards.FromSlug(slug.Trim(), out CardId id))
                    {
                        deck.Add(id);
                    }
                }

                if (Battle.IsValidDeck(deck))
                {
                    return deck;
                }
            }

            return Cards.DefaultDeck;
        }

        private static string QueryParam(string key)
        {
            string url = Application.absoluteURL;
            if (string.IsNullOrEmpty(url) || !url.Contains("?"))
            {
                return null;
            }

            string query = url.Substring(url.IndexOf('?') + 1);
            foreach (string pair in query.Split('&'))
            {
                int eq = pair.IndexOf('=');
                if (eq > 0 && pair.Substring(0, eq) == key)
                {
                    return Uri.UnescapeDataString(pair.Substring(eq + 1));
                }
            }

            return null;
        }

        /// <summary>The bot drafts a random legal 8-card deck, like the web build.</summary>
        private static List<CardId> RandomDeck()
        {
            var pool = new List<CardId>(Cards.Deck);
            var rng = new Mulberry32(unchecked((uint)(Environment.TickCount * 2654435761)));
            for (int i = pool.Count - 1; i > 0; i--)
            {
                int j = (int)Math.Floor(rng.Next() * (i + 1));
                (pool[i], pool[j]) = (pool[j], pool[i]);
            }

            return pool.GetRange(0, 8);
        }

        private void Update()
        {
            HandleDeployInput();

            accumulator += Math.Min(MaxFrame, Time.deltaTime);
            while (accumulator >= FixedDt)
            {
                Simulation.Tick(state, FixedDt);
                Bot.TickBot(state, bot, FixedDt);
                accumulator -= FixedDt;
            }

            state.Events.Clear();
            view.Sync(state);
            hud.UpdateHud(state);

            if (state.Result != null && !finished)
            {
                finished = true;
                hud.ShowResult(state.Result);
            }
        }

        private void HandleDeployInput()
        {
            if (state.Result != null || hud.SelectedIndex < 0)
            {
                return;
            }

            if (!Input.GetMouseButtonDown(0))
            {
                return;
            }

            // Don't treat a tap on the card row / HUD as a board deploy.
            if (EventSystem.current != null && EventSystem.current.IsPointerOverGameObject())
            {
                return;
            }

            // Intersect the camera ray with the board plane (y = 0) directly,
            // so deploys don't depend on physics colliders being present.
            Ray ray = view.Camera.ScreenPointToRay(Input.mousePosition);
            if (Mathf.Abs(ray.direction.y) < 1e-5f)
            {
                return;
            }

            float t = -ray.origin.y / ray.direction.y;
            if (t < 0f)
            {
                return;
            }

            Vector3 hitPoint = ray.origin + ray.direction * t;
            Vector2 sim = GameView.SimFromWorld(hitPoint);
            CardId card = state.Player.Hand.Cards[hud.SelectedIndex];
            if (Battle.DeployCard(state, Side.Player, card, sim.x, sim.y))
            {
                hud.ClearSelection();
            }
        }
    }
}
