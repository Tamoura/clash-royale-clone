using System;
using System.Collections.Generic;
using System.Linq;

namespace ClashRoyale.Sim
{
    /// <summary>
    /// The four playable cards plus the upcoming draw queue. Ported from
    /// <c>src/game/hand.ts</c>; treated as immutable (methods return copies).
    /// </summary>
    public sealed class HandState
    {
        public const int HandSize = 4;

        public IReadOnlyList<CardId> Cards { get; }
        public IReadOnlyList<CardId> Queue { get; }

        public HandState(IReadOnlyList<CardId> cards, IReadOnlyList<CardId> queue)
        {
            Cards = cards;
            Queue = queue;
        }

        public static HandState Create(IReadOnlyList<CardId> deck)
        {
            return new HandState(
                deck.Take(HandSize).ToList(),
                deck.Skip(HandSize).ToList());
        }

        public HandState Play(CardId id)
        {
            int index = -1;
            for (int i = 0; i < Cards.Count; i++)
            {
                if (Cards[i] == id)
                {
                    index = i;
                    break;
                }
            }

            if (index == -1)
            {
                throw new InvalidOperationException($"Card {id} is not in hand");
            }

            var cards = Cards.ToList();
            cards[index] = Queue[0];
            var queue = Queue.Skip(1).ToList();
            queue.Add(id);
            return new HandState(cards, queue);
        }
    }
}
