namespace DiceRoller.Core.Models;

public sealed class RollBatchResult
{
    public IReadOnlyList<DieResult> Results { get; init; } = Array.Empty<DieResult>();
    public int Total => Results.Sum(r => r.Value);
}
