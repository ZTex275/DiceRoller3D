namespace DiceRoller.Core.Models;

public sealed class DiceEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int Sides { get; set; } = 6;
    public int Count { get; set; } = 1;

    public DiceEntry Clone() => new()
    {
        Id = Id,
        Sides = Sides,
        Count = Count
    };
}
