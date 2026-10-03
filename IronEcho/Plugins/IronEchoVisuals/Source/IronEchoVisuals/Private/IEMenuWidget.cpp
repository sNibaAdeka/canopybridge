#include "IEMenuWidget.h"
#include "IETheme.h"
#include "IEFocusButton.h"
#include "Brushes/SlateColorBrush.h"
#include "Blueprint/WidgetTree.h"
#include "Blueprint/WidgetLayoutLibrary.h"
#include "Components/Border.h"
#include "Components/Button.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/SizeBox.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Styling/CoreStyle.h"
#include "Input/Reply.h"
#include "InputCoreTypes.h"

#define LOCTEXT_NAMESPACE "IronEchoMenu"

TSharedRef<SWidget> UIEMenuWidget::RebuildWidget()
{
    if (!WidgetTree) WidgetTree = NewObject<UWidgetTree>(this, TEXT("WidgetTree"));
    if (!PrimaryLabel) BuildTree();
    return Super::RebuildWidget();
}

void UIEMenuWidget::NativeConstruct()
{
    Super::NativeConstruct();
    EnterTime = 0.f;
    SetRenderOpacity(bReducedMotion ? 1.f : 0.f);
    SetCameraReady(bCameraReady);
    FocusButton(0);
}

void UIEMenuWidget::BuildTree()
{
    UBorder* Backdrop = WidgetTree->ConstructWidget<UBorder>();
    Backdrop->SetBrush(FSlateColorBrush(FLinearColor::White));
    Backdrop->SetBrushColor(IETheme::Background());
    Backdrop->SetPadding(FMargin(24.f));
    WidgetTree->RootWidget = Backdrop;
    UOverlay* Overlay = WidgetTree->ConstructWidget<UOverlay>();
    Backdrop->SetContent(Overlay);
    MenuWidth = WidgetTree->ConstructWidget<USizeBox>();
    MenuWidth->SetWidthOverride(480.f);
    UOverlaySlot* Position = Overlay->AddChildToOverlay(MenuWidth);
    Position->SetHorizontalAlignment(HAlign_Center);
    Position->SetVerticalAlignment(VAlign_Center);
    UVerticalBox* Column = WidgetTree->ConstructWidget<UVerticalBox>();
    MenuWidth->SetContent(Column);
    auto Label = [this, Column](const FText& Text, int32 FontSize, FLinearColor Color)
    {
        UTextBlock* Item = WidgetTree->ConstructWidget<UTextBlock>();
        Item->SetText(Text);
        Item->SetFont(FCoreStyle::GetDefaultFontStyle("Bold", FontSize));
        Item->SetColorAndOpacity(FSlateColor(Color));
        Item->SetAutoWrapText(true);
        Column->AddChildToVerticalBox(Item)->SetPadding(FMargin(0, 0, 0, 16.f));
        return Item;
    };
    Label(FText::FromString(TEXT("IRON ECHO")), 40, IETheme::Text());
    Label(LOCTEXT("Subtitle", "Твой робот. Твои движения."), 18, IETheme::TextMuted());
    StatusLabel = Label(LOCTEXT("CameraNeeded", "Для боя нужна камера. Сначала проверь положение тела."), 16, IETheme::TextMuted());
    const FText Labels[] = {
        LOCTEXT("Primary", "Настроить камеру"), LOCTEXT("Camera", "Камера и калибровка"),
        LOCTEXT("Settings", "Настройки"), LOCTEXT("Exit", "Выход")
    };
    for (int32 I = 0; I < 4; ++I)
    {
        UBorder* FocusRing = WidgetTree->ConstructWidget<UBorder>();
        FocusRing->SetBrush(FSlateColorBrush(FLinearColor::White));
        FocusRing->SetPadding(FMargin(IETheme::FocusThickness));
        FocusRing->SetBrushColor(IETheme::Surface());
        USizeBox* Size = WidgetTree->ConstructWidget<USizeBox>();
        Size->SetHeightOverride(IETheme::ButtonHeight);
        FocusRing->SetContent(Size);
        UButton* Button = WidgetTree->ConstructWidget<UIEFocusButton>();
        FButtonStyle Style = Button->GetStyle();
        Style.Normal = FSlateColorBrush(I == 0 ? IETheme::Primary() : IETheme::Surface());
        Style.Hovered = FSlateColorBrush(I == 0 ? IETheme::Primary() : IETheme::SurfaceRaised());
        Style.Pressed = Style.Hovered;
        Style.Disabled = FSlateColorBrush(IETheme::DisabledSurface());
        Button->SetStyle(Style);
        Size->SetContent(Button);
        UTextBlock* Text = WidgetTree->ConstructWidget<UTextBlock>();
        Text->SetText(Labels[I]);
        Text->SetFont(FCoreStyle::GetDefaultFontStyle("Bold", 18));
        Text->SetColorAndOpacity(FSlateColor(I == 0 ? IETheme::OnPrimary() : IETheme::Text()));
        Button->SetContent(Text);
        Column->AddChildToVerticalBox(FocusRing)->SetPadding(FMargin(0, 0, 0, 8.f));
        Buttons.Add(Button);
        FocusBorders.Add(FocusRing);
        if (I == 0) PrimaryLabel = Text;
    }
    Buttons[0]->OnClicked.AddDynamic(this, &UIEMenuWidget::PrimaryPressed);
    Buttons[1]->OnClicked.AddDynamic(this, &UIEMenuWidget::CalibrationPressed);
    Buttons[2]->OnClicked.AddDynamic(this, &UIEMenuWidget::SettingsPressed);
    Buttons[3]->OnClicked.AddDynamic(this, &UIEMenuWidget::ExitPressed);
}

void UIEMenuWidget::NativeTick(const FGeometry& Geometry, float Delta)
{
    Super::NativeTick(Geometry, Delta);
    EnterTime += FMath::Max(0.f, Delta);
    const float T = bReducedMotion ? 1.f : FMath::Clamp(EnterTime / IETheme::EnterSeconds, 0.f, 1.f);
    SetRenderOpacity(1.f - FMath::Pow(1.f-T, 3.f));
    if (MenuWidth)
    {
        const FVector2D View = UWidgetLayoutLibrary::GetViewportSize(this);
        const float Scale = FMath::Max(.1f, UWidgetLayoutLibrary::GetViewportScale(this));
        MenuWidth->SetWidthOverride(FMath::Clamp(View.X/Scale-48.f, 240.f, 480.f));
    }
    for (int32 I=0; I<Buttons.Num(); ++I)
        FocusBorders[I]->SetBrushColor(Buttons[I]->HasKeyboardFocus() ? IETheme::Focus() : IETheme::Surface());
}

FReply UIEMenuWidget::NativeOnPreviewKeyDown(const FGeometry& Geometry, const FKeyEvent& Event)
{
    for (int32 I=0; I<Buttons.Num(); ++I) if (Buttons[I]->HasKeyboardFocus()) FocusIndex=I;
    if (Event.GetKey()==EKeys::Down || Event.GetKey()==EKeys::Tab)
    {
        const int32 Step = Event.IsShiftDown() ? -1 : 1;
        FocusButton(FocusIndex+Step);
        return FReply::Handled();
    }
    if (Event.GetKey()==EKeys::Up)
    {
        FocusButton(FocusIndex-1);
        return FReply::Handled();
    }
    if (Event.GetKey()==EKeys::Escape)
    {
        OnActionRequested.Broadcast(EIEVisualAction::CloseRequested);
        return FReply::Handled();
    }
    return Super::NativeOnPreviewKeyDown(Geometry, Event);
}

void UIEMenuWidget::FocusButton(int32 Index)
{
    if (Buttons.IsEmpty()) return;
    FocusIndex=(Index+Buttons.Num())%Buttons.Num();
    Buttons[FocusIndex]->SetKeyboardFocus();
}
void UIEMenuWidget::SetCameraReady(bool Ready)
{
    bCameraReady=Ready;
    if (PrimaryLabel) PrimaryLabel->SetText(Ready ? LOCTEXT("Start", "Начать бой") : LOCTEXT("Setup", "Настроить камеру"));
    if (StatusLabel) StatusLabel->SetText(Ready ? LOCTEXT("CameraReady", "Камера и калибровка готовы. Можно начинать бой.") : LOCTEXT("CameraNeeded", "Для боя нужна камера. Сначала проверь положение тела."));
}
void UIEMenuWidget::SetReducedMotion(bool Reduce) { bReducedMotion=Reduce; if (Reduce) SetRenderOpacity(1.f); }
void UIEMenuWidget::ShowCameraMessage(const FText& Message) { if (StatusLabel) StatusLabel->SetText(Message); }
void UIEMenuWidget::FocusPrimaryAction() { FocusButton(0); }
void UIEMenuWidget::PrimaryPressed() { OnActionRequested.Broadcast(bCameraReady ? EIEVisualAction::StartMatch : EIEVisualAction::OpenCalibration); }
void UIEMenuWidget::CalibrationPressed() { OnActionRequested.Broadcast(EIEVisualAction::OpenCalibration); }
void UIEMenuWidget::SettingsPressed() { OnActionRequested.Broadcast(EIEVisualAction::OpenSettings); }
void UIEMenuWidget::ExitPressed() { OnActionRequested.Broadcast(EIEVisualAction::ExitRequested); }

#undef LOCTEXT_NAMESPACE
