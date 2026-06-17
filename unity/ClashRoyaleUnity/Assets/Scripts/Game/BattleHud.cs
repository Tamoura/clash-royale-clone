using System;
using ClashRoyale.Sim;
using UnityEngine;
using UnityEngine.UI;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Minimal screen-space HUD: match timer, crown counts, an elixir bar, the
    /// four-card hand, and a result banner. Built entirely in code so the scene
    /// can stay empty.
    /// </summary>
    public sealed class BattleHud : MonoBehaviour
    {
        private Font font;
        private Text timerText;
        private Text crownText;
        private Text elixirText;
        private Image elixirFill;
        private readonly Button[] cardButtons = new Button[HandState.HandSize];
        private readonly Image[] cardSwatches = new Image[HandState.HandSize];
        private readonly Text[] cardLabels = new Text[HandState.HandSize];
        private GameObject resultPanel;
        private Text resultText;

        /// <summary>Hand index the player has selected to deploy (-1 = none).</summary>
        public int SelectedIndex { get; private set; } = -1;

        public void Build(Action onRestart)
        {
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

            var canvasGo = new GameObject("HudCanvas");
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(900, 1600);
            canvasGo.AddComponent<GraphicRaycaster>();

            timerText = Label(canvas.transform, "Timer", new Vector2(0.5f, 1f), new Vector2(0, -40), 36, TextAnchor.MiddleCenter);
            crownText = Label(canvas.transform, "Crowns", new Vector2(0.5f, 1f), new Vector2(0, -90), 28, TextAnchor.MiddleCenter);

            BuildElixirBar(canvas.transform);
            BuildHand(canvas.transform);
            BuildResult(canvas.transform, onRestart);
        }

        private void BuildElixirBar(Transform parent)
        {
            Image bg = Panel(parent, "ElixirBg", new Color(0.10f, 0.06f, 0.16f, 0.9f));
            Anchor(bg.rectTransform, new Vector2(0.5f, 0f), new Vector2(620, 26), new Vector2(0, 250));

            // A left-anchored panel whose right edge we slide to show the fill.
            // (Width-driven rather than Image.fillAmount, which needs a sprite.)
            elixirFill = Panel(bg.transform, "ElixirFill", new Color(0.85f, 0.25f, 0.9f));
            elixirFill.rectTransform.anchorMin = new Vector2(0f, 0f);
            elixirFill.rectTransform.anchorMax = new Vector2(1f, 1f);
            elixirFill.rectTransform.pivot = new Vector2(0f, 0.5f);
            elixirFill.rectTransform.offsetMin = Vector2.zero;
            elixirFill.rectTransform.offsetMax = Vector2.zero;

            elixirText = Label(bg.transform, "ElixirNum", new Vector2(0.5f, 0.5f), Vector2.zero, 18, TextAnchor.MiddleCenter);
        }

        private void BuildHand(Transform parent)
        {
            const float width = 150f;
            const float gap = 12f;
            float total = HandState.HandSize * width + (HandState.HandSize - 1) * gap;
            float start = -total / 2f + width / 2f;

            for (int i = 0; i < HandState.HandSize; i++)
            {
                int index = i;
                Image swatch = Panel(parent, $"Card{i}", Color.gray);
                Anchor(swatch.rectTransform, new Vector2(0.5f, 0f), new Vector2(width, 110), new Vector2(start + i * (width + gap), 120));
                cardSwatches[i] = swatch;

                var button = swatch.gameObject.AddComponent<Button>();
                button.onClick.AddListener(() => Select(index));
                cardButtons[i] = button;

                cardLabels[i] = Label(swatch.transform, "Label", new Vector2(0.5f, 0.5f), Vector2.zero, 16, TextAnchor.MiddleCenter);
            }
        }

        private void BuildResult(Transform parent, Action onRestart)
        {
            Image panel = Panel(parent, "Result", new Color(0f, 0f, 0f, 0.82f));
            panel.rectTransform.anchorMin = Vector2.zero;
            panel.rectTransform.anchorMax = Vector2.one;
            panel.rectTransform.offsetMin = Vector2.zero;
            panel.rectTransform.offsetMax = Vector2.zero;
            resultPanel = panel.gameObject;

            resultText = Label(panel.transform, "ResultText", new Vector2(0.5f, 0.5f), new Vector2(0, 60), 48, TextAnchor.MiddleCenter);

            Image restart = Panel(panel.transform, "Restart", new Color(0.95f, 0.76f, 0.30f));
            Anchor(restart.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(260, 80), new Vector2(0, -60));
            var btn = restart.gameObject.AddComponent<Button>();
            btn.onClick.AddListener(() => onRestart());
            Text label = Label(restart.transform, "RestartLabel", new Vector2(0.5f, 0.5f), Vector2.zero, 28, TextAnchor.MiddleCenter);
            label.text = "Battle Again";
            label.color = new Color(0.23f, 0.14f, 0.01f);

            resultPanel.SetActive(false);
        }

        private void Select(int index)
        {
            SelectedIndex = SelectedIndex == index ? -1 : index;
        }

        public void ClearSelection()
        {
            SelectedIndex = -1;
        }

        public void UpdateHud(BattleState state)
        {
            double remaining = Math.Max(0, RemainingSeconds(state));
            int mins = (int)(remaining / 60);
            int secs = (int)(remaining % 60);
            timerText.text = (state.Overtime ? "OT " : "") + $"{mins}:{secs:00}";
            crownText.text = $"You {state.Player.Crowns}  —  {state.Enemy.Crowns} Bot";

            float elixir = (float)state.Player.Elixir.Amount;
            float frac = Mathf.Clamp01(elixir / (float)Elixir.ElixirMax);
            elixirFill.rectTransform.anchorMax = new Vector2(frac, 1f);
            elixirText.text = $"{Mathf.FloorToInt(elixir)}/10";

            for (int i = 0; i < HandState.HandSize; i++)
            {
                CardId id = state.Player.Hand.Cards[i];
                Card card = Cards.Get(id);
                bool affordable = card.Cost <= state.Player.Elixir.Amount;
                Color color = CardVisual.ForCard(id);
                cardSwatches[i].color = SelectedIndex == i ? Color.Lerp(color, Color.white, 0.5f) : color;
                cardLabels[i].text = $"{card.Name}\n{card.Cost}";
                cardLabels[i].color = affordable ? Color.white : new Color(1f, 1f, 1f, 0.45f);
            }
        }

        private static double RemainingSeconds(BattleState state)
        {
            return state.Overtime
                ? Simulation.BattleDuration + Simulation.OvertimeDuration - state.Time
                : Simulation.BattleDuration - state.Time;
        }

        public void ShowResult(BattleResult result)
        {
            resultPanel.SetActive(true);
            resultText.text = result.Winner switch
            {
                BattleWinner.Player => "Victory!",
                BattleWinner.Enemy => "Defeat",
                _ => "Draw",
            };
            resultText.color = result.Winner switch
            {
                BattleWinner.Player => new Color(0.5f, 0.9f, 1f),
                BattleWinner.Enemy => new Color(1f, 0.5f, 0.5f),
                _ => Color.white,
            };
        }

        public void HideResult()
        {
            resultPanel.SetActive(false);
        }

        // ---- tiny uGUI builders -------------------------------------------

        private Text Label(Transform parent, string name, Vector2 anchor, Vector2 pos, int size, TextAnchor align)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var text = go.AddComponent<Text>();
            text.font = font;
            text.fontSize = size;
            text.alignment = align;
            text.color = Color.white;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            RectTransform rt = text.rectTransform;
            rt.anchorMin = anchor;
            rt.anchorMax = anchor;
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.sizeDelta = new Vector2(400, 80);
            rt.anchoredPosition = pos;
            return text;
        }

        private static Image Panel(Transform parent, string name, Color color)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.color = color;
            return image;
        }

        private static void Anchor(RectTransform rt, Vector2 anchor, Vector2 size, Vector2 pos)
        {
            rt.anchorMin = anchor;
            rt.anchorMax = anchor;
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.sizeDelta = size;
            rt.anchoredPosition = pos;
        }
    }
}
