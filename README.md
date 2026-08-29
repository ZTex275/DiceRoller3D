# DiceRoller3D

3D-симулятор бросания кубиков на C# для Web и Android.

## Структура

- DiceRoller.Core — общая логика (модели, генерация бросков)
- DiceRoller.Web — Blazor WebAssembly + Three.js (браузер)
- DiceRoller.Maui — .NET MAUI Blazor Hybrid (Android/iOS)

## Возможности

- Любое число граней (d2, d6, d8, d100 и т.д.)
- Несколько типов кубиков за один бросок (например: 1×d6 + 2×d8 + 1×d100)
- 3D-анимация броска с отображением результата
- Разные 3D-формы для стандартных кубиков (4/6/8/10/12/20 граней)

## Запуск Web

```bash
cd src/DiceRoller.Web
dotnet run
```

Откройте http://localhost:5xxx в браузере.

## Сборка Android

Требуется .NET MAUI workload и Android SDK:

```bash
dotnet workload install maui
cd src/DiceRoller.Maui
dotnet build -f net8.0-android
```

## Пример

1. Нажмите «+ Добавить тип»
2. Укажите грани и количество
3. Нажмите «Бросить!»
