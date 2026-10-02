// Force-included when checking that the core compiles inside Unreal / Windows macro soup.
// Every macro below exists in Unreal or <windows.h>; a collision with core identifiers breaks this build.
#pragma once
#define check(expr) ((void)0)
#define checkf(expr, ...) ((void)0)
#define verify(expr) ((void)(expr))
#define ensure(expr) (!!(expr))
#define PI (3.1415926535897932f)
#define INDEX_NONE (-1)
#define IN
#define OUT
#define OPTIONAL
#define near
#define far
#define min(a, b) (((a) < (b)) ? (a) : (b))
#define max(a, b) (((a) > (b)) ? (a) : (b))
#define ERROR 0
#define DELETE (0x00010000L)
#define TRANSPARENT 1
#define OPAQUE 2
#define ABSOLUTE 1
#define RELATIVE 2
#define TEXT(x) L##x
#define interface struct
#define small char
#define SendMessage SendMessageW
#define GetObject GetObjectW
#define DrawText DrawTextW
#define CreateEvent CreateEventW
#define Yield()
#define TRUE 1
#define FALSE 0
#define FORCEINLINE inline
