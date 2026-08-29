namespace DiceRoller.Core.Models;

public static class SupportedDice
{
    public static readonly int[] Sides = [2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 100];

    public static bool IsSupported(int sides) => Array.IndexOf(Sides, sides) >= 0;
}
