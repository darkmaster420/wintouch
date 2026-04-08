/*
 *  WinTouch – left-edge back-gesture helper (native Win32 + GDI+)
 *
 *  Shows an iOS / Android-style curved wave with a back-arrow when the
 *  user swipes right from the left edge of the screen.
 *
 *  The window covers a ~250 px strip on the left.  Only non-transparent
 *  pixels are hit-testable (UpdateLayeredWindow + per-pixel alpha), so
 *  in idle mode only a thin 6 px trigger zone captures input.
 */

#define WIN32_LEAN_AND_MEAN
#define UNICODE
#include <windows.h>
#include <windowsx.h>
#include <objidl.h>
#include <gdiplus.h>
#include <cmath>
#include <cstdio>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "gdiplus.lib")

// ── Configuration ───────────────────────────────────────────
static constexpr int   STRIP_W       = 32;      // idle trigger-zone width (wide for touch)
static constexpr int   WAVE_W        = 250;     // max window width for wave
static constexpr int   SWIPE_THRESH  = 80;      // px to fire back
static constexpr int   MIN_DX        = 10;      // dead-zone
static constexpr float SPREAD        = 200.0f;  // vertical Gaussian spread

// ── Global state ────────────────────────────────────────────
static HWND      g_hwnd     = nullptr;
static int       g_scrH     = 0;
static bool      g_tracking = false;
static bool      g_swiping  = false;
static POINT     g_start    = {};
static int       g_touchY   = 0;
static int       g_dx       = 0;
static ULONG_PTR g_gdip     = 0;
static FILE*     g_log      = nullptr;

// ── Debug log ───────────────────────────────────────────────
static void Log(const char* fmt, ...) {
    if (!g_log) return;
    va_list ap;
    va_start(ap, fmt);
    vfprintf(g_log, fmt, ap);
    va_end(ap);
    fputc('\n', g_log);
    fflush(g_log);
}

// ── Helpers ─────────────────────────────────────────────────
static bool GetPointerScreenPos(WPARAM wp, POINT& pt) {
    POINTER_INFO pi = {};
    if (GetPointerInfo(GET_POINTERID_WPARAM(wp), &pi)) {
        pt = pi.ptPixelLocation;
        return true;
    }
    return false;
}

static void SendBackKey() {
    // Window has WS_EX_NOACTIVATE so the target app still has focus
    INPUT inp[4] = {};
    inp[0].type = INPUT_KEYBOARD;  inp[0].ki.wVk = VK_MENU;
    inp[1].type = INPUT_KEYBOARD;  inp[1].ki.wVk = VK_LEFT;
    inp[2].type = INPUT_KEYBOARD;  inp[2].ki.wVk = VK_LEFT;
    inp[2].ki.dwFlags = KEYEVENTF_KEYUP;
    inp[3].type = INPUT_KEYBOARD;  inp[3].ki.wVk = VK_MENU;
    inp[3].ki.dwFlags = KEYEVENTF_KEYUP;
    UINT sent = SendInput(4, inp, sizeof(INPUT));
    Log("SendInput returned %u (expected 4), GetLastError=%lu", sent, GetLastError());
}

// ── Rendering ───────────────────────────────────────────────
static void Repaint() {
    using namespace Gdiplus;

    // 1.  Allocate a 32-bit pre-multiplied-alpha DIB
    HDC hdcScr = GetDC(nullptr);
    HDC hdcMem = CreateCompatibleDC(hdcScr);

    BITMAPINFO bmi = {};
    bmi.bmiHeader.biSize        = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth       = WAVE_W;
    bmi.bmiHeader.biHeight      = -g_scrH;          // top-down
    bmi.bmiHeader.biPlanes      = 1;
    bmi.bmiHeader.biBitCount    = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    void* bits = nullptr;
    HBITMAP hbmp = CreateDIBSection(hdcMem, &bmi, DIB_RGB_COLORS, &bits, nullptr, 0);
    HGDIOBJ oldBmp = SelectObject(hdcMem, hbmp);
    memset(bits, 0, WAVE_W * g_scrH * 4);           // fully transparent

    // 2.  Wrap a GDI+ Bitmap around the raw pixel buffer
    {
        Bitmap bmp(WAVE_W, g_scrH, WAVE_W * 4,
                   PixelFormat32bppPARGB, static_cast<BYTE*>(bits));
        Graphics gfx(&bmp);
        gfx.SetSmoothingMode(SmoothingModeAntiAlias);

        if (g_swiping && g_dx > 0) {
            // ── Wave shape ──────────────────────────────────
            float maxB = fminf(static_cast<float>(g_dx) * 1.5f,
                               static_cast<float>(WAVE_W - 20));

            constexpr int N = 64;
            PointF poly[N + 3];                      // left-top, left-bottom, N+1 curve pts
            poly[0] = PointF(0.0f, 0.0f);
            poly[1] = PointF(0.0f, static_cast<float>(g_scrH));

            for (int i = 0; i <= N; ++i) {
                float y  = static_cast<float>(g_scrH) * static_cast<float>(N - i) / N;
                float dy = y - static_cast<float>(g_touchY);
                float b  = maxB * expf(-(dy * dy) / (2.0f * SPREAD * SPREAD));
                poly[2 + i] = PointF(static_cast<float>(STRIP_W) + b, y);
            }

            SolidBrush fill(Color(190, 0, 0, 0));
            gfx.FillPolygon(&fill, poly, N + 3);

            // ── Edge highlight ──────────────────────────────
            PointF edge[N + 1];
            for (int i = 0; i <= N; ++i) edge[i] = poly[2 + i];
            Pen edgePen(Color(60, 120, 240, 208), 1.5f);
            gfx.DrawLines(&edgePen, edge, N + 1);

            // ── Back arrow chevron ──────────────────────────
            if (maxB > 20.0f) {
                float cx = static_cast<float>(STRIP_W) + maxB * 0.38f;
                float cy = static_cast<float>(g_touchY);
                float s  = fminf(maxB * 0.14f, 14.0f);
                int   a  = static_cast<int>(fminf(maxB * 3.0f, 255.0f));

                Pen pen(Color(static_cast<BYTE>(a), 255, 255, 255), 2.8f);
                pen.SetStartCap(LineCapRound);
                pen.SetEndCap(LineCapRound);
                pen.SetLineJoin(LineJoinRound);
                gfx.DrawLine(&pen, cx + s, cy - s, cx, cy);
                gfx.DrawLine(&pen, cx, cy, cx + s, cy + s);
            }
        } else {
            // ── Idle: thin teal strip ───────────────────────
            SolidBrush strip(Color(80, 30, 80, 65));
            gfx.FillRectangle(&strip, 0, 0, STRIP_W, g_scrH);
        }
    }   // GDI+ Bitmap + Graphics destroyed → flushed to pixel buffer

    // 3.  Push to screen via UpdateLayeredWindow
    POINT ptSrc = {0, 0}, ptDst = {0, 0};
    SIZE  sz    = {WAVE_W, g_scrH};
    BLENDFUNCTION bf = {};
    bf.BlendOp             = AC_SRC_OVER;
    bf.SourceConstantAlpha = 255;
    bf.AlphaFormat         = AC_SRC_ALPHA;
    UpdateLayeredWindow(g_hwnd, hdcScr, &ptDst, &sz, hdcMem, &ptSrc, 0, &bf, ULW_ALPHA);

    SelectObject(hdcMem, oldBmp);
    DeleteObject(hbmp);
    DeleteDC(hdcMem);
    ReleaseDC(nullptr, hdcScr);
}

static void ResetState() {
    g_tracking = false;
    g_swiping  = false;
    g_dx       = 0;
    // Toggle WS_EX_LAYERED to switch back from UpdateLayeredWindow to
    // SetLayeredWindowAttributes mode, then set alpha=1 (invisible but hit-testable)
    LONG ex = GetWindowLongW(g_hwnd, GWL_EXSTYLE);
    SetWindowLongW(g_hwnd, GWL_EXSTYLE, ex & ~WS_EX_LAYERED);
    SetWindowLongW(g_hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED);
    SetWindowPos(g_hwnd, HWND_TOPMOST, 0, 0, STRIP_W, g_scrH,
                 SWP_NOMOVE | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    SetLayeredWindowAttributes(g_hwnd, 0, 5, LWA_ALPHA);
}

static void EnterSwipeMode() {
    // Must toggle WS_EX_LAYERED off/on to switch from SetLayeredWindowAttributes
    // mode (idle) to UpdateLayeredWindow per-pixel alpha mode (swipe).
    LONG ex = GetWindowLongW(g_hwnd, GWL_EXSTYLE);
    SetWindowLongW(g_hwnd, GWL_EXSTYLE, ex & ~WS_EX_LAYERED);
    SetWindowLongW(g_hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED);
    // Expand to full wave width
    SetWindowPos(g_hwnd, HWND_TOPMOST, 0, 0, WAVE_W, g_scrH,
                 SWP_NOMOVE | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    Repaint();
}

// ── Window Procedure ────────────────────────────────────────
static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {

    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        GetClientRect(hwnd, &rc);
        HBRUSH brush = CreateSolidBrush(RGB(20, 55, 45));
        FillRect(hdc, &rc, brush);
        DeleteObject(brush);
        EndPaint(hwnd, &ps);
        return 0;
    }

    case WM_POINTERDOWN: {
        POINT pt;
        if (!GetPointerScreenPos(wp, pt)) return 0;
        g_start    = pt;
        g_touchY   = pt.y;
        g_tracking = true;
        g_swiping  = false;
        g_dx       = 0;
        Log("POINTER_DOWN  x=%d y=%d  fg=%p", pt.x, pt.y, (void*)GetForegroundWindow());
        return 0;
    }

    case WM_POINTERUPDATE: {
        if (!g_tracking) return 0;
        POINT pt;
        if (!GetPointerScreenPos(wp, pt)) return 0;
        int dx = pt.x - g_start.x;
        int dy = abs(pt.y - g_start.y);

        if (!g_swiping && dx > MIN_DX && dx > dy) {
            g_swiping = true;
            EnterSwipeMode();
            Log("SWIPING started dx=%d", dx);
        }

        if (g_swiping) {
            g_dx = dx;
            Repaint();
        }
        return 0;
    }

    case WM_POINTERUP:
    case WM_POINTERLEAVE:
    case WM_POINTERCAPTURECHANGED:
        if (g_tracking) {
            Log("POINTER_UP/LEAVE  swiping=%d dx=%d", g_swiping, g_dx);
            if (g_swiping && g_dx > SWIPE_THRESH) {
                Log("SWIPE COMPLETE dx=%d \u2192 SendBackKey", g_dx);
                SendBackKey();
            }
            ResetState();
        }
        return 0;

    case WM_LBUTTONDOWN: {
        Log("WM_LBUTTONDOWN  (fallback) x=%d y=%d", GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
        POINT pt;
        GetCursorPos(&pt);
        g_start    = pt;
        g_touchY   = pt.y;
        g_tracking = true;
        g_swiping  = false;
        g_dx       = 0;
        SetCapture(hwnd);
        return 0;
    }

    case WM_TOUCH: {
        UINT cInputs = LOWORD(wp);
        TOUCHINPUT* ti = new TOUCHINPUT[cInputs];
        if (GetTouchInputInfo((HTOUCHINPUT)lp, cInputs, ti, sizeof(TOUCHINPUT))) {
            POINT pt = { ti[0].x / 100, ti[0].y / 100 };
            DWORD flags = ti[0].dwFlags;
            CloseTouchInputHandle((HTOUCHINPUT)lp);

            if (flags & TOUCHEVENTF_DOWN) {
                Log("WM_TOUCH DOWN x=%ld y=%ld", pt.x, pt.y);
                g_start    = pt;
                g_touchY   = (int)pt.y;
                g_tracking = true;
                g_swiping  = false;
                g_dx       = 0;
            } else if ((flags & TOUCHEVENTF_MOVE) && g_tracking) {
                int dx = (int)(pt.x - g_start.x);
                int dy = abs((int)(pt.y - g_start.y));
                if (!g_swiping && dx > MIN_DX && dx > dy) {
                    g_swiping = true;
                    EnterSwipeMode();
                    Log("SWIPING (touch) dx=%d", dx);
                }
                if (g_swiping) {
                    g_dx = dx;
                    Repaint();
                }
            } else if ((flags & TOUCHEVENTF_UP) && g_tracking) {
                Log("WM_TOUCH UP swiping=%d dx=%d", g_swiping, g_dx);
                if (g_swiping && g_dx > SWIPE_THRESH) {
                    Log("SWIPE COMPLETE (touch) dx=%d \u2192 SendBackKey", g_dx);
                    SendBackKey();
                }
                ResetState();
            }
        }
        delete[] ti;
        return 0;
    }

    case WM_MOUSEMOVE: {
        if (!g_tracking) return 0;
        POINT pt;
        GetCursorPos(&pt);
        int dx = pt.x - g_start.x;
        int dy = abs(pt.y - g_start.y);

        if (!g_swiping && dx > MIN_DX && dx > dy) {
            g_swiping = true;
            EnterSwipeMode();
            Log("SWIPING (mouse) dx=%d", dx);
        }

        if (g_swiping) {
            g_dx = dx;
            Repaint();
        }
        return 0;
    }

    case WM_LBUTTONUP:
        if (g_tracking) {
            Log("WM_LBUTTONUP  swiping=%d dx=%d", g_swiping, g_dx);
            if (g_swiping && g_dx > SWIPE_THRESH) {
                Log("SWIPE COMPLETE (mouse) dx=%d \u2192 SendBackKey", g_dx);
                SendBackKey();
            }
            ReleaseCapture();
            ResetState();
        }
        return 0;

    case WM_DISPLAYCHANGE:
        g_scrH = GetSystemMetrics(SM_CYSCREEN);
        ResetState();
        return 0;

    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;

    default:
        return DefWindowProcW(hwnd, msg, wp, lp);
    }
}

// ── Entry Point ─────────────────────────────────────────────
int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, LPWSTR, int) {
    HANDLE mutex = CreateMutexW(nullptr, TRUE, L"WinTouchGestureStrip");
    if (GetLastError() == ERROR_ALREADY_EXISTS) return 0;

    // Debug log next to the exe
    {
        wchar_t logPath[MAX_PATH];
        GetModuleFileNameW(nullptr, logPath, MAX_PATH);
        // Replace .exe with .log
        wchar_t* dot = wcsrchr(logPath, L'.');
        if (dot) wcscpy_s(dot, 5, L".log");
        g_log = _wfopen(logPath, L"w");
    }
    Log("gesture.exe started");

    // Route mouse input through WM_POINTER (touch + pen already use it)
    if (!EnableMouseInPointer(TRUE)) {
        Log("EnableMouseInPointer FAILED err=%lu", GetLastError());
    }

    Gdiplus::GdiplusStartupInput gsi;
    Gdiplus::GdiplusStartup(&g_gdip, &gsi, nullptr);

    g_scrH = GetSystemMetrics(SM_CYSCREEN);
    Log("screen height=%d", g_scrH);

    WNDCLASSEXW wc = {};
    wc.cbSize        = sizeof(wc);
    wc.lpfnWndProc   = WndProc;
    wc.hInstance      = hInst;
    wc.lpszClassName  = L"WinTouchGesture";
    wc.hCursor       = LoadCursorW(nullptr, IDC_SIZEWE);
    RegisterClassExW(&wc);

    g_hwnd = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED,
        wc.lpszClassName, L"",
        WS_POPUP | WS_VISIBLE,
        0, 0, STRIP_W, g_scrH,
        nullptr, nullptr, hInst, nullptr);

    if (!g_hwnd) return 1;
    Log("window created hwnd=%p", (void*)g_hwnd);

    // Near-invisible but still hit-testable (alpha=5 for touch digitizer compat)
    SetLayeredWindowAttributes(g_hwnd, 0, 5, LWA_ALPHA);

    // Register for WM_TOUCH as fallback for digitizers that skip WM_POINTER
    RegisterTouchWindow(g_hwnd, TWF_WANTPALM);

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    Gdiplus::GdiplusShutdown(g_gdip);
    CloseHandle(mutex);
    return 0;
}
