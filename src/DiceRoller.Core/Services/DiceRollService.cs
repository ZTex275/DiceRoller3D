using DiceRoller.Core.Models;

namespace DiceRoller.Core.Services;

public sealed class DiceRollService
{
    public RollBatchResult Roll(IEnumerable<DiceEntry> entries)
    {
        var results = new List<DieResult>();

        foreach (var entry in entries)
        {
            if (entry.Count <= 0 || entry.Sides < 1)
            {
                continue;
            }

            for (var i = 0; i < entry.Count; i++)
            {
                results.Add(new DieResult
                {
                    EntryId = entry.Id,
                    Sides = entry.Sides,
                    Value = entry.Sides == 1 ? 1 : Random.Shared.Next(1, entry.Sides + 1),
                    IndexInGroup = i
                });
            }
        }

        return new RollBatchResult { Results = results };
    }
}
