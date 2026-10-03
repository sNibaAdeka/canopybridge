#include "IEHUDWidget.h"
#include "IETheme.h"
#include "Brushes/SlateColorBrush.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/TextBlock.h"
#include "Components/ProgressBar.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/SizeBox.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Styling/CoreStyle.h"

#define LOCTEXT_NAMESPACE "IronEchoHUD"

TSharedRef<SWidget> UIEHUDWidget::RebuildWidget()
{
    if (!WidgetTree) WidgetTree = NewObject<UWidgetTree>(this, TEXT("WidgetTree"));
    if (!PlayerLabel) BuildTree();
    return Super::RebuildWidget();
}

void UIEHUDWidget::NativeConstruct()
{
    Super::NativeConstruct();
    ClearSnapshot();
}

void UIEHUDWidget::BuildTree()
{
    UOverlay* Root=WidgetTree->ConstructWidget<UOverlay>();
    WidgetTree->RootWidget=Root;
    UBorder* Panel=WidgetTree->ConstructWidget<UBorder>();
    Panel->SetBrush(FSlateColorBrush(FLinearColor::White));
    Panel->SetBrushColor(IETheme::Surface());
    Panel->SetPadding(FMargin(12.f));
    UOverlaySlot* Position=Root->AddChildToOverlay(Panel);
    Position->SetHorizontalAlignment(HAlign_Fill);
    Position->SetVerticalAlignment(VAlign_Top);
    Position->SetPadding(FMargin(12.f));
    UVerticalBox* Column=WidgetTree->ConstructWidget<UVerticalBox>();
    Panel->SetContent(Column);
    auto Label=[this](UVerticalBox* Parent, int32 FontSize)
    {
        UTextBlock* Text=WidgetTree->ConstructWidget<UTextBlock>();
        Text->SetFont(FCoreStyle::GetDefaultFontStyle("Regular",FontSize));
        Text->SetColorAndOpacity(FSlateColor(IETheme::Text()));
        Text->SetAutoWrapText(true);
        Parent->AddChildToVerticalBox(Text)->SetPadding(FMargin(0,0,0,8));
        return Text;
    };
    auto Bar=[this](UVerticalBox* Parent, FLinearColor Color)
    {
        UProgressBar* Value=WidgetTree->ConstructWidget<UProgressBar>();
        FProgressBarStyle Style;
        Style.BackgroundImage=FSlateColorBrush(IETheme::SurfaceRaised());
        Style.FillImage=FSlateColorBrush(FLinearColor::White);
        Value->SetWidgetStyle(Style);
        Value->SetFillColorAndOpacity(Color);
        USizeBox* Height=WidgetTree->ConstructWidget<USizeBox>();
        Height->SetHeightOverride(10.f);
        Height->SetContent(Value);
        Parent->AddChildToVerticalBox(Height)->SetPadding(FMargin(0,0,0,8));
        return Value;
    };
    TimerLabel=Label(Column,22);
    TimerLabel->SetJustification(ETextJustify::Center);
    UHorizontalBox* Fighters=WidgetTree->ConstructWidget<UHorizontalBox>();
    Column->AddChildToVerticalBox(Fighters);
    UVerticalBox* Player=WidgetTree->ConstructWidget<UVerticalBox>();
    UHorizontalBoxSlot* PlayerSlot=Fighters->AddChildToHorizontalBox(Player);
    PlayerSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill));
    PlayerSlot->SetPadding(FMargin(0,0,8,0));
    UVerticalBox* Opponent=WidgetTree->ConstructWidget<UVerticalBox>();
    UHorizontalBoxSlot* OpponentSlot=Fighters->AddChildToHorizontalBox(Opponent);
    OpponentSlot->SetSize(FSlateChildSize(ESlateSizeRule::Fill));
    OpponentSlot->SetPadding(FMargin(8,0,0,0));
    PlayerLabel=Label(Player,18); PlayerBar=Bar(Player,IETheme::HealthPlayer());
    OpponentLabel=Label(Opponent,18); OpponentBar=Bar(Opponent,IETheme::HealthOpponent());
    OpponentLabel->SetJustification(ETextJustify::Right);
    StaminaLabel=Label(Player,16); StaminaBar=Bar(Player,IETheme::Stamina());
    UBorder* TrackingPanel=WidgetTree->ConstructWidget<UBorder>();
    TrackingPanel->SetBrush(FSlateColorBrush(FLinearColor::White));
    TrackingPanel->SetBrushColor(IETheme::Surface());
    TrackingPanel->SetPadding(FMargin(12.f));
    UOverlaySlot* TrackingSlot=Root->AddChildToOverlay(TrackingPanel);
    TrackingSlot->SetHorizontalAlignment(HAlign_Fill);
    TrackingSlot->SetVerticalAlignment(VAlign_Bottom);
    TrackingSlot->SetPadding(FMargin(12.f));
    UVerticalBox* TrackingColumn=WidgetTree->ConstructWidget<UVerticalBox>();
    TrackingPanel->SetContent(TrackingColumn);
    TrackingLabel=Label(TrackingColumn,16);
}

bool UIEHUDWidget::ApplySnapshot(const FIEHUDSnapshot& S)
{
    auto ValidResource=[](float Value,float Max)
    {
        return FMath::IsFinite(Value) && FMath::IsFinite(Max) && Max>0.f && Max<10000000.f && Value>=0.f && Value<=Max;
    };
    const bool Valid=ValidResource(S.PlayerHealth,S.PlayerMaxHealth) && ValidResource(S.OpponentHealth,S.OpponentMaxHealth)
        && ValidResource(S.PlayerStamina,S.PlayerMaxStamina) && FMath::IsFinite(S.SecondsRemaining)
        && S.SecondsRemaining>=0.f && S.SecondsRemaining<86400.f && S.Round>0 && S.Round<=S.TotalRounds && S.TotalRounds<=99;
    if (!Valid || !PlayerLabel) { ClearSnapshot(); return false; }
    SetVisibility(ESlateVisibility::SelfHitTestInvisible);
    PlayerLabel->SetText(FText::Format(LOCTEXT("Health","{0} — здоровье {1} / {2}"),S.PlayerName,FText::AsNumber(FMath::RoundToInt(S.PlayerHealth)),FText::AsNumber(FMath::RoundToInt(S.PlayerMaxHealth))));
    OpponentLabel->SetText(FText::Format(LOCTEXT("EnemyHealth","{0} — здоровье {1} / {2}"),S.OpponentName,FText::AsNumber(FMath::RoundToInt(S.OpponentHealth)),FText::AsNumber(FMath::RoundToInt(S.OpponentMaxHealth))));
    StaminaLabel->SetText(FText::Format(LOCTEXT("Stamina","Выносливость {0} / {1}"),FText::AsNumber(FMath::RoundToInt(S.PlayerStamina)),FText::AsNumber(FMath::RoundToInt(S.PlayerMaxStamina))));
    PlayerBar->SetPercent(S.PlayerHealth/S.PlayerMaxHealth);
    OpponentBar->SetPercent(S.OpponentHealth/S.OpponentMaxHealth);
    StaminaBar->SetPercent(S.PlayerStamina/S.PlayerMaxStamina);
    const int32 Seconds=FMath::CeilToInt(S.SecondsRemaining);
    TimerLabel->SetText(FText::Format(LOCTEXT("Round","Раунд {0}/{1} · {2}"),FText::AsNumber(S.Round),FText::AsNumber(S.TotalRounds),FText::FromString(FString::Printf(TEXT("%02d:%02d"),Seconds/60,Seconds%60))));
    FText Tracking;
    switch (S.Tracking)
    {
        case EIETrackingPresentation::Ready: Tracking=LOCTEXT("Ready","Камера: готово"); break;
        case EIETrackingPresentation::Degraded: Tracking=LOCTEXT("Degraded","Камера: руки видны не полностью"); break;
        case EIETrackingPresentation::Lost: Tracking=LOCTEXT("Lost","Камера: вернись в кадр"); break;
        case EIETrackingPresentation::Paused: Tracking=LOCTEXT("Paused","Бой приостановлен"); break;
        default: Tracking=LOCTEXT("Unknown","Камера: ожидание данных"); break;
    }
    TrackingLabel->SetText(Tracking);
    TrackingLabel->SetColorAndOpacity(FSlateColor(S.Tracking==EIETrackingPresentation::Ready ? IETheme::TextMuted() : IETheme::Warning()));
    return true;
}

void UIEHUDWidget::ClearSnapshot()
{
    SetVisibility(ESlateVisibility::Collapsed);
}
#undef LOCTEXT_NAMESPACE
