namespace DiceRoller.Core.Models;

public sealed class DieResult
{
    public Guid EntryId { get; init; }
    public int Sides { get; init; }
    public int Value { get; init; }
    public int IndexInGroup { get; init; }
}
