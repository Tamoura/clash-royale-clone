using System;
using ClashRoyale.Sim;
using UnityEngine;

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
            view = gameObject.AddComponent<GameView>();
            view.Build();

            hud = gameObject.AddComponent<BattleHud>();
            hud.Build(Restart);

            StartBattle();
        }

        private void StartBattle()
        {
            state = Battle.CreateBattle(Cards.DefaultDeck, RandomDeck());
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

        /// <summary>The bot drafts a random legal 8-card deck, like the web build.</summary>
        private static System.Collections.Generic.List<CardId> RandomDeck()
        {
            var pool = new System.Collections.Generic.List<CardId>(Cards.Deck);
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
