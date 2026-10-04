#pragma once

// Engine-independent presentation rules. Used by runtime code and portable tests.
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace IronEchoPresentation
{
struct FEventKey
{
    std::uint32_t A=0, B=0, C=0, D=0;
    bool IsValid() const { return (A | B | C | D)!=0; }
    bool operator==(const FEventKey& Other) const
    { return A==Other.A && B==Other.B && C==Other.C && D==Other.D; }
};

class FEventHistory
{
public:
    static constexpr std::size_t Capacity=512;
    bool Accept(const FEventKey& Key)
    {
        if (!Key.IsValid()) return false;
        for (std::size_t Index=0; Index<Count; ++Index)
            if (Keys[Index]==Key) return false;
        Keys[Cursor]=Key;
        Cursor=(Cursor+1)%Capacity;
        if (Count<Capacity) ++Count;
        return true;
    }
    void Reset() { Count=0; Cursor=0; }
    std::size_t Size() const { return Count; }
private:
    std::array<FEventKey,Capacity> Keys{};
    std::size_t Count=0, Cursor=0;
};

inline double ClampUnit(double Value)
{ return Value<0.0 ? 0.0 : (Value>1.0 ? 1.0 : Value); }
inline bool IsUsableTime(double Now) { return std::isfinite(Now) && Now>=0.0; }

class FReactionHold
{
public:
    bool Accept(const FEventKey& Key, double Intensity, double Now)
    {
        if (!IsUsableTime(Now) || !std::isfinite(Intensity) || !History.Accept(Key)) return false;
        // Contacts during the window or recovery gap cannot extend the hold.
        if (!ReducedMotion && Intensity>0.0 && Now>=NextAllowed)
        {
            Started=Now;
            Until=Now+0.040+0.025*ClampUnit(Intensity);
            NextAllowed=Until+0.100;
        }
        return true;
    }
    float PlayRate(double Now) const
    {
        // Invalid/rewound clocks fail open rather than leaving a pose stuck.
        return !ReducedMotion && IsUsableTime(Now) && Now>=Started && Now<Until ? 0.f : 1.f;
    }
    void SetReducedMotion(bool Reduce)
    {
        ReducedMotion=Reduce;
        if (Reduce) { Started=0.0; Until=0.0; }
    }
    void Reset()
    {
        History.Reset(); Started=0.0; Until=0.0; NextAllowed=0.0;
        // A session reset must preserve the user's accessibility preference.
    }
private:
    FEventHistory History;
    double Started=0.0, Until=0.0, NextAllowed=0.0;
    bool ReducedMotion=false;
};

class FCameraPulse
{
public:
    static constexpr double Duration=0.160;
    void Start(double Intensity, double Scale, double Now)
    {
        if (!IsUsableTime(Now) || !std::isfinite(Intensity) || !std::isfinite(Scale)) return;
        Started=Now;
        Strength=ClampUnit(Intensity)*ClampUnit(Scale)*1.5;
    }
    double OffsetCm(double Now) const
    {
        if (!IsUsableTime(Now) || Now<Started || Now>=Started+Duration) return 0.0;
        const double Progress=(Now-Started)/Duration;
        return std::sin(Progress*3.0*3.14159265358979323846)*(1.0-Progress)*Strength;
    }
    void Reset() { Strength=0.0; Started=0.0; }
private:
    double Started=0.0, Strength=0.0;
};
}
