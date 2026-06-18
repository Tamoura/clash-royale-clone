using System;
using ClashRoyale.Sim;
using UnityEngine;
using UnityEngine.UI;

namespace ClashRoyale.Game
{
    /// <summary>
    /// Screen-space HUD mirroring the web build: a top bar (crowns + clock), an
    /// elixir bar with x2 tag, a four-card hand of rounded tiles with cost gems,
    /// a "next" preview, and a result overlay with per-side stats.
    /// </summary>
    public sealed class BattleHud : MonoBehaviour
    {
        private sealed class CardSlot
        {
            public RectTransform Root;
            public Image Tile;
            public Image Glyph;
            public Text GlyphLetter;
            public Image Veil;
            public Image Selected;
            public Text CostText;
            public Text NameText;
        }

        private Font font;
        private Text clockText;
        private Text playerCrowns;
        private Text enemyCrowns;
        private Image elixirFill;
        private Text elixirNum;
        private Text x2Tag;
        private readonly CardSlot[] slots = new CardSlot[HandState.HandSize];
        private CardSlot nextSlot;
        private GameObject resultPanel;
        private Text resultText;
        private Text resultStats;

        private static readonly Color Pink = new Color(0.85f, 0.2f, 0.75f);
        private static readonly Color PinkHot = new Color(1f, 0.45f, 0.2f);
        private static readonly Color PlayerBlue = new Color(0.3f, 0.6f, 1f);
        private static readonly Color EnemyRed = new Color(1f, 0.4f, 0.4f);

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
            scaler.referenceResolution = new Vector2(1080, 1920);
            scaler.matchWidthOrHeight = 0.6f;
            canvasGo.AddComponent<GraphicRaycaster>();
            Transform root = canvas.transform;

            BuildTopBar(root);
            BuildElixir(root);
            BuildHand(root);
            BuildResult(root, onRestart);
        }

        // ---- top bar ------------------------------------------------------

        private void BuildTopBar(Transform root)
        {
            Image bar = Panel(root, new Color(0.08f, 0.10f, 0.16f, 0.82f));
            Anchor(bar.rectTransform, new Vector2(0.5f, 1f), new Vector2(720, 96), new Vector2(0, -58));

            playerCrowns = Label(bar.transform, new Vector2(0f, 0.5f), new Vector2(150, -0), 40, TextAnchor.MiddleLeft);
            playerCrowns.rectTransform.anchoredPosition = new Vector2(40, 0);
            playerCrowns.color = PlayerBlue;
            playerCrowns.text = "♛ 0";

            clockText = Label(bar.transform, new Vector2(0.5f, 0.5f), Vector2.zero, 44, TextAnchor.MiddleCenter);
            clockText.text = "3:00";

            enemyCrowns = Label(bar.transform, new Vector2(1f, 0.5f), new Vector2(-40, 0), 40, TextAnchor.MiddleRight);
            enemyCrowns.color = EnemyRed;
            enemyCrowns.text = "0 ♛";
        }

        // ---- elixir -------------------------------------------------------

        private void BuildElixir(Transform root)
        {
            Image num = Panel(root, Pink, Visuals.CircleSprite());
            Anchor(num.rectTransform, new Vector2(0.5f, 0f), new Vector2(64, 64), new Vector2(-330, 300));
            elixirNum = Label(num.transform, new Vector2(0.5f, 0.5f), Vector2.zero, 34, TextAnchor.MiddleCenter);
            elixirNum.text = "5";

            Image bg = Panel(root, new Color(0.12f, 0.06f, 0.16f, 0.95f));
            Anchor(bg.rectTransform, new Vector2(0.5f, 0f), new Vector2(600, 40), new Vector2(20, 300));

            elixirFill = Panel(bg.transform, Pink);
            elixirFill.rectTransform.anchorMin = new Vector2(0f, 0f);
            elixirFill.rectTransform.anchorMax = new Vector2(1f, 1f);
            elixirFill.rectTransform.pivot = new Vector2(0f, 0.5f);
            elixirFill.rectTransform.offsetMin = new Vector2(4, 4);
            elixirFill.rectTransform.offsetMax = new Vector2(-4, -4);

            x2Tag = Label(bg.transform, new Vector2(1f, 0.5f), new Vector2(-26, 0), 26, TextAnchor.MiddleRight);
            x2Tag.text = "";
            x2Tag.color = new Color(1f, 0.9f, 0.3f);
        }

        // ---- hand ---------------------------------------------------------

        private void BuildHand(Transform root)
        {
            const float w = 168f;
            const float h = 200f;
            const float gap = 16f;
            float total = HandState.HandSize * w + (HandState.HandSize - 1) * gap;
            float start = -total / 2f + w / 2f + 70f; // shift right, leaving room for "next"

            for (int i = 0; i < HandState.HandSize; i++)
            {
                slots[i] = MakeCard(root, new Vector2(start + i * (w + gap), 150), new Vector2(w, h), true, i);
            }

            // "next" preview, smaller, far left
            Label(root, new Vector2(0.5f, 0f), new Vector2(start - w + 6, 230), 24, TextAnchor.MiddleCenter).text = "next";
            nextSlot = MakeCard(root, new Vector2(start - w - 4, 140), new Vector2(108, 130), false, -1);
        }

        private CardSlot MakeCard(Transform root, Vector2 pos, Vector2 size, bool interactive, int index)
        {
            var slot = new CardSlot();

            // gold selection backing (slightly larger), hidden by default
            Image sel = Panel(root, new Color(1f, 0.85f, 0.3f), Visuals.RoundedSprite());
            Anchor(sel.rectTransform, new Vector2(0.5f, 0f), size + new Vector2(14, 14), pos);
            sel.gameObject.SetActive(false);
            slot.Selected = sel;

            Image tile = Panel(root, Color.gray, Visuals.RoundedSprite());
            Anchor(tile.rectTransform, new Vector2(0.5f, 0f), size, pos);
            slot.Tile = tile;
            slot.Root = tile.rectTransform;

            // glyph disc with the card initial
            Image glyph = Panel(tile.transform, Color.white, Visuals.CircleSprite());
            Anchor(glyph.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(size.x * 0.5f, size.x * 0.5f), new Vector2(0, size.y * 0.08f));
            slot.Glyph = glyph;
            slot.GlyphLetter = Label(glyph.transform, new Vector2(0.5f, 0.5f), Vector2.zero, Mathf.RoundToInt(size.x * 0.34f), TextAnchor.MiddleCenter);
            slot.GlyphLetter.color = new Color(0.1f, 0.12f, 0.18f);

            slot.NameText = Label(tile.transform, new Vector2(0.5f, 0f), new Vector2(0, 20), Mathf.RoundToInt(size.x * 0.12f), TextAnchor.MiddleCenter);
            slot.NameText.rectTransform.sizeDelta = new Vector2(size.x, 36);

            // cost gem
            Image gem = Panel(tile.transform, Pink, Visuals.CircleSprite());
            Anchor(gem.rectTransform, new Vector2(0f, 1f), new Vector2(46, 46), new Vector2(24, -24));
            slot.CostText = Label(gem.transform, new Vector2(0.5f, 0.5f), Vector2.zero, 26, TextAnchor.MiddleCenter);

            // unaffordable veil
            Image veil = Panel(tile.transform, new Color(0.02f, 0.02f, 0.05f, 0.6f), Visuals.RoundedSprite());
            veil.rectTransform.anchorMin = Vector2.zero;
            veil.rectTransform.anchorMax = Vector2.one;
            veil.rectTransform.offsetMin = Vector2.zero;
            veil.rectTransform.offsetMax = Vector2.zero;
            veil.gameObject.SetActive(false);
            slot.Veil = veil;

            if (interactive)
            {
                var btn = tile.gameObject.AddComponent<Button>();
                int idx = index;
                btn.onClick.AddListener(() => Select(idx));
            }

            return slot;
        }

        private void Select(int index)
        {
            SelectedIndex = SelectedIndex == index ? -1 : index;
        }

        public void ClearSelection()
        {
            SelectedIndex = -1;
        }

        // ---- result -------------------------------------------------------

        private void BuildResult(Transform root, Action onRestart)
        {
            Image panel = Panel(root, new Color(0f, 0f, 0f, 0.82f));
            panel.rectTransform.anchorMin = Vector2.zero;
            panel.rectTransform.anchorMax = Vector2.one;
            panel.rectTransform.offsetMin = Vector2.zero;
            panel.rectTransform.offsetMax = Vector2.zero;
            resultPanel = panel.gameObject;

            resultText = Label(panel.transform, new Vector2(0.5f, 0.5f), new Vector2(0, 200), 90, TextAnchor.MiddleCenter);
            resultStats = Label(panel.transform, new Vector2(0.5f, 0.5f), new Vector2(0, 20), 34, TextAnchor.MiddleCenter);
            resultStats.rectTransform.sizeDelta = new Vector2(800, 300);

            Image btn = Panel(panel.transform, new Color(0.95f, 0.76f, 0.3f), Visuals.RoundedSprite());
            Anchor(btn.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(320, 96), new Vector2(0, -200));
            btn.gameObject.AddComponent<Button>().onClick.AddListener(() => onRestart());
            Text label = Label(btn.transform, new Vector2(0.5f, 0.5f), Vector2.zero, 34, TextAnchor.MiddleCenter);
            label.text = "Play Again";
            label.color = new Color(0.2f, 0.12f, 0.01f);

            resultPanel.SetActive(false);
        }

        // ---- update -------------------------------------------------------

        public void UpdateHud(BattleState state)
        {
            double remaining = Math.Max(0, RemainingSeconds(state));
            int mins = (int)(remaining / 60);
            int secs = (int)(remaining % 60);
            clockText.text = (state.Overtime ? "OT " : "") + $"{mins}:{secs:00}";
            playerCrowns.text = $"♛ {state.Player.Crowns}";
            enemyCrowns.text = $"{state.Enemy.Crowns} ♛";

            float elixir = (float)state.Player.Elixir.Amount;
            float frac = Mathf.Clamp01(elixir / (float)Elixir.ElixirMax);
            elixirFill.rectTransform.anchorMax = new Vector2(frac, 1f);
            elixirNum.text = $"{Mathf.FloorToInt(elixir)}";
            int mult = Simulation.ElixirMultiplier(state);
            bool dbl = mult >= 2 && state.Result == null;
            elixirFill.color = dbl ? PinkHot : Pink;
            x2Tag.text = mult == 3 ? "x3" : (mult == 2 ? "x2" : "");

            for (int i = 0; i < HandState.HandSize; i++)
            {
                Paint(slots[i], state.Player.Hand.Cards[i], elixir, i == SelectedIndex);
            }

            CardId next = state.Player.Hand.Queue.Count > 0 ? state.Player.Hand.Queue[0] : state.Player.Hand.Cards[0];
            Paint(nextSlot, next, elixir, false);
        }

        private void Paint(CardSlot slot, CardId id, float elixir, bool selected)
        {
            Card card = Cards.Get(id);
            Color color = CardVisual.ForCard(id);
            slot.Tile.color = color;
            slot.Glyph.color = Color.Lerp(color, Color.white, 0.65f);
            if (slot.GlyphLetter != null)
            {
                slot.GlyphLetter.text = card.Name.Substring(0, 1);
            }

            if (slot.NameText != null)
            {
                slot.NameText.text = card.Name;
            }

            if (slot.CostText != null)
            {
                slot.CostText.text = card.Cost.ToString();
            }

            bool affordable = card.Cost <= elixir;
            if (slot.Veil != null)
            {
                slot.Veil.gameObject.SetActive(!affordable);
            }

            if (slot.Selected != null)
            {
                slot.Selected.gameObject.SetActive(selected);
            }
        }

        private static double RemainingSeconds(BattleState state)
        {
            return state.Overtime
                ? Simulation.BattleDuration + Simulation.OvertimeDuration - state.Time
                : Simulation.BattleDuration - state.Time;
        }

        public void ShowResult(BattleState state)
        {
            resultPanel.SetActive(true);
            BattleResult r = state.Result;
            resultText.text = r.Winner switch
            {
                BattleWinner.Player => "Victory!",
                BattleWinner.Enemy => "Defeat",
                _ => "Draw",
            };
            resultText.color = r.Winner switch
            {
                BattleWinner.Player => new Color(0.5f, 0.9f, 1f),
                BattleWinner.Enemy => new Color(1f, 0.5f, 0.5f),
                _ => Color.white,
            };
            resultStats.text =
                $"You {r.PlayerCrowns}  –  {r.EnemyCrowns} Bot\n\n" +
                $"Damage dealt   {Mathf.RoundToInt((float)state.Player.Stats.DamageDealt)}  vs  {Mathf.RoundToInt((float)state.Enemy.Stats.DamageDealt)}\n" +
                $"Elixir spent   {Mathf.RoundToInt((float)state.Player.Stats.ElixirSpent)}  vs  {Mathf.RoundToInt((float)state.Enemy.Stats.ElixirSpent)}";
        }

        public void HideResult()
        {
            resultPanel.SetActive(false);
        }

        // ---- builders -----------------------------------------------------

        private static Image Panel(Transform parent, Color color, Sprite sprite = null)
        {
            var go = new GameObject("panel");
            go.transform.SetParent(parent, false);
            var img = go.AddComponent<Image>();
            img.color = color;
            if (sprite != null)
            {
                img.sprite = sprite;
                img.type = Image.Type.Sliced;
            }

            return img;
        }

        private Text Label(Transform parent, Vector2 anchor, Vector2 pos, int size, TextAnchor align)
        {
            var go = new GameObject("label");
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
            rt.sizeDelta = new Vector2(360, 80);
            rt.anchoredPosition = pos;
            return text;
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
