import cv2
import mediapipe as mp
import pygame
import sys
import math
import random
from collections import Counter, deque

# ==========================================
# 1. PYGAME SETUP (GUI & MAZE ENGINE)
# ==========================================
pygame.init()

TILE_SIZE = 40

# 20x15 Maze Layout (W = Wall, Space = Path, S = Start, E = End)
maze_layout = [
    "WWWWWWWWWWWWWWWWWWWW",
    "WS  W       W      W",
    "W W W WWWWW W WWWW W",
    "W W   W   W   W    W",
    "W WWWWW W WWWWW WW W",
    "W       W       W  W",
    "WWWW WWWWWWWWWWWW  W",
    "W    W      W      W",
    "W WWWW WWWW W WWWW W",
    "W W  W    W W W  W W",
    "W W  WWWW W W W  W W",
    "W W     W W   W  W W",
    "W WWWWW W WWWWW  W W",
    "W                WEW",
    "WWWWWWWWWWWWWWWWWWWW"
]

MAZE_W = len(maze_layout[0]) * TILE_SIZE
MAZE_H = len(maze_layout) * TILE_SIZE

# Layout
MARGIN = 20
HEADER_H = 70
MAZE_X, MAZE_Y = MARGIN, HEADER_H + MARGIN
PANEL_X = MAZE_X + MAZE_W + MARGIN
PANEL_W = 380
WIN_W = PANEL_X + PANEL_W + MARGIN
WIN_H = MAZE_Y + MAZE_H + MARGIN
CAM_W, CAM_H = PANEL_W, PANEL_W * 3 // 4

screen = pygame.display.set_mode((WIN_W, WIN_H))
pygame.display.set_caption("Neon Maze - Gesture Controlled")
clock = pygame.time.Clock()

# Colors
BG_TOP = (9, 8, 20)
BG_BOTTOM = (22, 15, 45)
CARD = (22, 20, 42)
CARD_INNER = (32, 29, 60)
CARD_BORDER = (55, 50, 98)
TEXT = (236, 238, 255)
MUTED = (135, 135, 175)
FLOOR_COLOR = (14, 12, 28)
FLOOR_ALT = (19, 17, 37)
WALL_FILL = (22, 30, 70)
WALL_EDGE = (0, 200, 255)
GOAL_COLOR = (255, 60, 140)
GOLD = (255, 214, 102)
ROBOT_BODY = (255, 150, 40)
ROBOT_HEAD = (210, 225, 240)
ROBOT_LEGS = (150, 165, 190)
ROBOT_VISOR = (25, 30, 50)
ROBOT_EYE = (0, 255, 200)

# Neon theme per stage; cycles after the last one
THEMES = [
    {"name": "CYAN",    "edge": (0, 200, 255),   "fill": (22, 30, 70),  "floor": (14, 12, 28), "floor_alt": (19, 17, 37), "goal": (255, 60, 140)},
    {"name": "MAGENTA", "edge": (255, 70, 200),  "fill": (58, 18, 64),  "floor": (20, 10, 26), "floor_alt": (27, 14, 34), "goal": (0, 230, 255)},
    {"name": "LIME",    "edge": (120, 255, 90),  "fill": (18, 52, 34),  "floor": (10, 20, 14), "floor_alt": (14, 27, 19), "goal": (255, 80, 200)},
    {"name": "SUNSET",  "edge": (255, 140, 40),  "fill": (64, 30, 14),  "floor": (22, 13, 8),  "floor_alt": (29, 18, 11), "goal": (120, 200, 255)},
    {"name": "VIOLET",  "edge": (170, 110, 255), "fill": (38, 22, 80),  "floor": (15, 10, 30), "floor_alt": (21, 15, 40), "goal": (255, 214, 102)},
    {"name": "CRIMSON", "edge": (255, 60, 80),   "fill": (66, 16, 26),  "floor": (22, 8, 12),  "floor_alt": (30, 12, 17), "goal": (0, 255, 200)},
]

FONT_NAMES = "avenirnext,helveticaneue,helvetica,arial"


def make_font(size, bold=False):
    return pygame.font.SysFont(FONT_NAMES, size, bold=bold)


title_font = make_font(34, bold=True)
big_font = make_font(48, bold=True)
value_font = make_font(26, bold=True)
body_font = make_font(18, bold=True)
small_font = make_font(15)
label_font = make_font(12, bold=True)

walls = []
start_tile = end_tile = (1, 1)
for row_idx, row in enumerate(maze_layout):
    for col_idx, tile in enumerate(row):
        if tile == "W":
            walls.append(pygame.Rect(col_idx * TILE_SIZE, row_idx * TILE_SIZE, TILE_SIZE, TILE_SIZE))
        elif tile == "S":
            start_tile = (row_idx, col_idx)
        elif tile == "E":
            end_tile = (row_idx, col_idx)

end_rect = pygame.Rect(end_tile[1] * TILE_SIZE, end_tile[0] * TILE_SIZE, TILE_SIZE, TILE_SIZE)

MOVE_SPEED = 220  # pixels per second

# ==========================================
# 2. MEDIAPIPE SETUP
# ==========================================
# (Assuming you are using mediapipe==0.10.14 as discussed!)
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(min_detection_confidence=0.7,
                       min_tracking_confidence=0.6,
                       max_num_hands=1)
mp_draw = mp.solutions.drawing_utils


def find_builtin_camera():
    # OpenCV indexes cameras in AVFoundation's device order, and an iPhone
    # (Continuity Camera) can take index 0 ahead of the built-in webcam.
    try:
        import AVFoundation as AV
    except ImportError:
        return 0
    devices = AV.AVCaptureDevice.devicesWithMediaType_(AV.AVMediaTypeVideo)
    for idx, device in enumerate(devices):
        name = device.localizedName()
        if "FaceTime" in name or "Built-in" in name:
            print(f"Using camera {idx}: {name}")
            return idx
    return 0


cap = cv2.VideoCapture(find_builtin_camera(), cv2.CAP_AVFOUNDATION)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

# ==========================================
# 3. GESTURE RECOGNITION LOGIC
# ==========================================
class GestureFilter:
    """Pinch + point detection, smoothed over recent frames.

    The robot moves only while thumb and index are pinched; the direction is
    where the pinch sits relative to the wrist (hand up = UP, tilted
    sideways = LEFT/RIGHT, pointing down = DOWN).
    """

    # Pinch distance as a fraction of hand size. Separate on/off thresholds
    # stop the pinch from flickering when the fingers hover near the limit.
    PINCH_ON = 0.30
    PINCH_OFF = 0.50

    def __init__(self):
        self.pinched = False
        self.direction = "NONE"
        self.ratio = None
        self.history = deque(maxlen=5)

    def _point_direction(self, dx, dy):
        horizontal = "PINCH RIGHT" if dx > 0 else "PINCH LEFT"
        vertical = "PINCH DOWN" if dy > 0 else "PINCH UP"
        # Near-diagonal poses keep the current axis instead of flip-flopping
        if self.direction == horizontal and abs(dx) > abs(dy) * 0.75:
            return horizontal
        if self.direction == vertical and abs(dy) > abs(dx) * 0.75:
            return vertical
        return horizontal if abs(dx) > abs(dy) else vertical

    def update(self, hand):
        raw = "NONE"
        if hand is None:
            self.pinched = False
            self.ratio = None
        else:
            lm = hand.landmark
            wrist = lm[mp_hands.HandLandmark.WRIST]
            middle_mcp = lm[mp_hands.HandLandmark.MIDDLE_FINGER_MCP]
            thumb_tip = lm[mp_hands.HandLandmark.THUMB_TIP]
            index_tip = lm[mp_hands.HandLandmark.INDEX_FINGER_TIP]

            hand_size = math.hypot(middle_mcp.x - wrist.x, middle_mcp.y - wrist.y)
            pinch_dist = math.hypot(thumb_tip.x - index_tip.x, thumb_tip.y - index_tip.y)
            self.ratio = pinch_dist / hand_size if hand_size else 1.0
            self.pinched = self.ratio < (self.PINCH_OFF if self.pinched else self.PINCH_ON)

            if self.pinched:
                pinch_x = (thumb_tip.x + index_tip.x) / 2
                pinch_y = (thumb_tip.y + index_tip.y) / 2
                raw = self._point_direction(pinch_x - wrist.x, pinch_y - wrist.y)

        self.history.append(raw)
        value, count = Counter(self.history).most_common(1)[0]
        if count >= 3:
            self.direction = value
        return self.direction

    @property
    def hand_state(self):
        if self.ratio is None:
            return "NO HAND"
        return "PINCH" if self.pinched else "OPEN"


DIRECTIONS = {
    "PINCH UP": (0, -1),
    "PINCH DOWN": (0, 1),
    "PINCH LEFT": (-1, 0),
    "PINCH RIGHT": (1, 0),
}
KEY_DIRECTIONS = {
    pygame.K_UP: (0, -1),
    pygame.K_DOWN: (0, 1),
    pygame.K_LEFT: (-1, 0),
    pygame.K_RIGHT: (1, 0),
}

# ==========================================
# 4. DRAWING HELPERS
# ==========================================
def is_wall(row, col):
    if 0 <= row < len(maze_layout) and 0 <= col < len(maze_layout[row]):
        return maze_layout[row][col] == "W"
    return True


def tile_center(tile):
    row, col = tile
    return [col * TILE_SIZE + TILE_SIZE / 2, row * TILE_SIZE + TILE_SIZE / 2]


def blur(surface, factor=8):
    w, h = surface.get_size()
    small = pygame.transform.smoothscale(surface, (max(1, w // factor), max(1, h // factor)))
    return pygame.transform.smoothscale(small, (w, h))


def draw_card(surf, rect, color=CARD):
    pygame.draw.rect(surf, color, rect, border_radius=14)
    pygame.draw.rect(surf, CARD_BORDER, rect, 1, border_radius=14)


def build_maze_surface():
    surf = pygame.Surface((MAZE_W, MAZE_H))
    surf.fill(FLOOR_COLOR)
    for r, row in enumerate(maze_layout):
        for c, tile in enumerate(row):
            if tile != "W" and (r + c) % 2 == 0:
                pygame.draw.rect(surf, FLOOR_ALT, (c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE))

    glow = pygame.Surface((MAZE_W, MAZE_H), pygame.SRCALPHA)
    for wall in walls:
        pygame.draw.rect(glow, (*WALL_EDGE, 110), wall.inflate(12, 12), border_radius=10)
    surf.blit(blur(glow, 10), (0, 0))

    for wall in walls:
        pygame.draw.rect(surf, WALL_FILL, wall)

    # Neon outline only on wall sides that face open floor
    for r, row in enumerate(maze_layout):
        for c, tile in enumerate(row):
            if tile != "W":
                continue
            x, y = c * TILE_SIZE, r * TILE_SIZE
            x2, y2 = x + TILE_SIZE - 1, y + TILE_SIZE - 1
            if r > 0 and not is_wall(r - 1, c):
                pygame.draw.line(surf, WALL_EDGE, (x, y), (x2, y), 3)
            if r < len(maze_layout) - 1 and not is_wall(r + 1, c):
                pygame.draw.line(surf, WALL_EDGE, (x, y2), (x2, y2), 3)
            if c > 0 and not is_wall(r, c - 1):
                pygame.draw.line(surf, WALL_EDGE, (x, y), (x, y2), 3)
            if c < len(row) - 1 and not is_wall(r, c + 1):
                pygame.draw.line(surf, WALL_EDGE, (x2, y), (x2, y2), 3)

    # Start pad
    sx, sy = tile_center(start_tile)
    pygame.draw.circle(surf, (40, 60, 110), (int(sx), int(sy)), 15)
    pygame.draw.circle(surf, WALL_EDGE, (int(sx), int(sy)), 15, 2)
    return surf


def build_background(stage, theme_name):
    surf = pygame.Surface((WIN_W, WIN_H))
    for y in range(WIN_H):
        k = y / WIN_H
        color = [int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * k) for i in range(3)]
        pygame.draw.line(surf, color, (0, y), (WIN_W, y))

    # Header title with neon glow
    title = title_font.render("NEON MAZE", True, TEXT)
    title_pos = (MARGIN, (HEADER_H - title.get_height()) // 2 + 6)
    glow = pygame.Surface((title.get_width() + 40, title.get_height() + 40), pygame.SRCALPHA)
    glow.blit(title_font.render("NEON MAZE", True, WALL_EDGE), (20, 20))
    surf.blit(blur(glow, 4), (title_pos[0] - 20, title_pos[1] - 20))
    surf.blit(title, title_pos)

    subtitle = small_font.render("Guide the robot to the portal with hand gestures", True, MUTED)
    surf.blit(subtitle, (title_pos[0] + title.get_width() + 18,
                         title_pos[1] + title.get_height() - subtitle.get_height() - 6))

    hint = small_font.render("ESC to quit", True, MUTED)
    baseline = title_pos[1] + title.get_height() - 6
    surf.blit(hint, (WIN_W - MARGIN - hint.get_width(), baseline - hint.get_height()))

    stage_text = body_font.render(f"STAGE {stage}  ·  {theme_name}", True, WALL_EDGE)
    chip = pygame.Rect(0, 0, stage_text.get_width() + 28, stage_text.get_height() + 10)
    chip.right = MAZE_X + MAZE_W
    chip.centery = baseline - hint.get_height() // 2
    pygame.draw.rect(surf, CARD, chip, border_radius=chip.height // 2)
    pygame.draw.rect(surf, WALL_EDGE, chip, 2, border_radius=chip.height // 2)
    surf.blit(stage_text, stage_text.get_rect(center=chip.center))

    # Maze frame glow
    maze_rect = pygame.Rect(MAZE_X, MAZE_Y, MAZE_W, MAZE_H)
    frame_glow = pygame.Surface((MAZE_W + 60, MAZE_H + 60), pygame.SRCALPHA)
    pygame.draw.rect(frame_glow, (*WALL_EDGE, 90), (30 - 6, 30 - 6, MAZE_W + 12, MAZE_H + 12), border_radius=12)
    surf.blit(blur(frame_glow, 12), (MAZE_X - 30, MAZE_Y - 30))
    pygame.draw.rect(surf, WALL_EDGE, maze_rect.inflate(6, 6), 2, border_radius=6)

    draw_card(surf, stats_rect)
    draw_card(surf, controls_rect)
    return surf


def draw_goal(surf, t):
    cx, cy = end_rect.center
    pulse = (math.sin(t * 4) + 1) / 2
    glow = pygame.Surface((80, 80), pygame.SRCALPHA)
    pygame.draw.circle(glow, (*GOAL_COLOR, 40), (40, 40), 30 + pulse * 6)
    pygame.draw.circle(glow, (*GOAL_COLOR, 80), (40, 40), 20 + pulse * 3)
    surf.blit(glow, (cx - 40, cy - 40))
    pygame.draw.circle(surf, GOAL_COLOR, (cx, cy), 14, 3)

    points = []
    for i in range(10):
        angle = t * 2 + i * math.pi / 5
        radius = 10 if i % 2 == 0 else 4
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    pygame.draw.polygon(surf, GOLD, points)


def draw_character(surf, center, facing, moving, t):
    cx, cy = center
    fx, fy = facing
    bob = math.sin(t * 14) * 2 if moving else math.sin(t * 3)
    swing = math.sin(t * 14) * 4 if moving else 0

    shadow = pygame.Surface((28, 10), pygame.SRCALPHA)
    pygame.draw.ellipse(shadow, (0, 0, 0, 120), shadow.get_rect())
    surf.blit(shadow, (cx - 14, cy + 11))

    pygame.draw.rect(surf, ROBOT_LEGS, (cx - 7, cy + 6 + swing / 2, 5, 8), border_radius=2)
    pygame.draw.rect(surf, ROBOT_LEGS, (cx + 2, cy + 6 - swing / 2, 5, 8), border_radius=2)

    body_y = cy - 1 + bob
    pygame.draw.rect(surf, ROBOT_BODY, (cx - 9, body_y, 18, 11), border_radius=4)
    pygame.draw.circle(surf, GOLD, (int(cx), int(body_y + 5)), 2)

    # Head with visor; eyes look in the movement direction
    head_y = cy - 15 + bob
    pygame.draw.rect(surf, ROBOT_HEAD, (cx - 11, head_y, 22, 15), border_radius=6)
    if fy < 0:
        pygame.draw.rect(surf, (170, 185, 205), (cx - 7, head_y + 4, 14, 6), border_radius=3)
    else:
        pygame.draw.rect(surf, ROBOT_VISOR, (cx - 8, head_y + 3, 16, 9), border_radius=4)
        ex, ey = cx + fx * 2, head_y + 7 + fy
        pygame.draw.circle(surf, ROBOT_EYE, (int(ex - 3), int(ey)), 2)
        pygame.draw.circle(surf, ROBOT_EYE, (int(ex + 3), int(ey)), 2)

    pygame.draw.line(surf, ROBOT_HEAD, (cx, head_y), (cx, head_y - 5), 2)
    tip_color = GOAL_COLOR if int(t * 2) % 2 == 0 else GOLD
    pygame.draw.circle(surf, tip_color, (int(cx), int(head_y - 6)), 3)


def draw_camera(frame, t):
    if frame is not None:
        h, w = frame.shape[:2]
        crop_w = h * 4 // 3
        if w > crop_w:
            x0 = (w - crop_w) // 2
            frame = frame[:, x0:x0 + crop_w]
        rgb = cv2.cvtColor(cv2.resize(frame, (CAM_W, CAM_H)), cv2.COLOR_BGR2RGB)
        cam = pygame.image.frombuffer(rgb.tobytes(), (CAM_W, CAM_H), "RGB").convert_alpha()
        cam.blit(cam_mask, (0, 0), special_flags=pygame.BLEND_RGBA_MIN)
        screen.blit(cam, cam_rect)
    else:
        draw_card(screen, cam_rect)
        msg = body_font.render("Camera unavailable", True, TEXT)
        sub = small_font.render("Check camera permission in System Settings", True, MUTED)
        screen.blit(msg, msg.get_rect(center=(cam_rect.centerx, cam_rect.centery - 12)))
        screen.blit(sub, sub.get_rect(center=(cam_rect.centerx, cam_rect.centery + 14)))
    pygame.draw.rect(screen, CARD_BORDER, cam_rect, 2, border_radius=14)

    # LIVE badge
    live = label_font.render("LIVE", True, TEXT)
    badge = pygame.Rect(cam_rect.x + 12, cam_rect.y + 12, live.get_width() + 30, 24)
    badge_surf = pygame.Surface(badge.size, pygame.SRCALPHA)
    pygame.draw.rect(badge_surf, (0, 0, 0, 160), badge_surf.get_rect(), border_radius=12)
    screen.blit(badge_surf, badge)
    dot_on = frame is not None and int(t * 2) % 2 == 0
    pygame.draw.circle(screen, (255, 70, 70) if dot_on else (110, 40, 40), (badge.x + 12, badge.centery), 4)
    screen.blit(live, (badge.x + 22, badge.centery - live.get_height() // 2))


def draw_stats(score, elapsed, best_time, completions):
    items = [
        ("SCORE", str(score), GOLD),
        ("TIME", f"{elapsed:.1f}s", TEXT),
        ("BEST", f"{best_time:.1f}s" if best_time is not None else "--", ROBOT_EYE),
        ("CLEARED", str(completions), GOAL_COLOR),
    ]
    gap = 8
    inner = stats_rect.inflate(-20, -20)
    tile_w = (inner.width - gap * 3) // 4
    for i, (label, value, color) in enumerate(items):
        tile = pygame.Rect(inner.x + i * (tile_w + gap), inner.y, tile_w, inner.height)
        pygame.draw.rect(screen, CARD_INNER, tile, border_radius=10)
        label_surf = label_font.render(label, True, MUTED)
        screen.blit(label_surf, label_surf.get_rect(midtop=(tile.centerx, tile.y + 10)))
        value_surf = value_font.render(value, True, color)
        if value_surf.get_width() > tile.width - 8:
            value_surf = body_font.render(value, True, color)
        screen.blit(value_surf, value_surf.get_rect(midbottom=(tile.centerx, tile.bottom - 8)))


def draw_arrow(center, direction, color):
    cx, cy = center
    dx, dy = direction
    px, py = -dy, dx
    tip = (cx + dx * 10, cy + dy * 10)
    left = (cx - dx * 7 + px * 9, cy - dy * 7 + py * 9)
    right = (cx - dx * 7 - px * 9, cy - dy * 7 - py * 9)
    pygame.draw.polygon(screen, color, [tip, left, right])


def draw_controls(gesture, gesture_filter, active_dir):
    title = label_font.render("CONTROLS", True, MUTED)
    screen.blit(title, (controls_rect.x + 16, controls_rect.y + 14))

    # D-pad showing the active direction
    pad_center = (controls_rect.x + 100, controls_rect.y + 108)
    for direction in DIRECTIONS.values():
        rect = pygame.Rect(0, 0, 44, 44)
        rect.center = (pad_center[0] + direction[0] * 50, pad_center[1] + direction[1] * 50)
        active = direction == active_dir
        pygame.draw.rect(screen, WALL_EDGE if active else CARD_INNER, rect, border_radius=10)
        if not active:
            pygame.draw.rect(screen, CARD_BORDER, rect, 1, border_radius=10)
        draw_arrow(rect.center, direction, ROBOT_VISOR if active else MUTED)

    state = gesture_filter.hand_state
    state_color = {"PINCH": GOAL_COLOR, "OPEN": (90, 90, 140), "NO HAND": (50, 48, 75)}[state]
    pygame.draw.circle(screen, state_color, pad_center, 18)

    # Hand status and pinch meter
    x = controls_rect.x + 200
    y = controls_rect.y + 36
    screen.blit(label_font.render("HAND", True, MUTED), (x, y))
    state_text_color = GOAL_COLOR if state == "PINCH" else (TEXT if state == "OPEN" else MUTED)
    screen.blit(body_font.render(state, True, state_text_color), (x, y + 16))

    y += 50
    screen.blit(label_font.render("PINCH STRENGTH", True, MUTED), (x, y))
    bar = pygame.Rect(x, y + 20, controls_rect.right - x - 18, 10)
    pygame.draw.rect(screen, CARD_INNER, bar, border_radius=5)
    if gesture_filter.ratio is not None:
        strength = (1.0 - gesture_filter.ratio) / (1.0 - GestureFilter.PINCH_ON)
        strength = max(0.0, min(1.0, strength))
        fill = bar.copy()
        fill.width = max(10, int(bar.width * strength))
        pygame.draw.rect(screen, GOAL_COLOR if gesture_filter.pinched else WALL_EDGE, fill, border_radius=5)

    y += 44
    for line in ("Pinch + point to move", "Open hand to stop", "Arrow keys also work"):
        screen.blit(small_font.render(line, True, MUTED), (x, y))
        y += 19


def draw_win_overlay(surf, alpha, points, run_time, score, next_label):
    panel = pygame.Rect(0, 0, 440, 225)
    panel.center = (MAZE_W // 2, MAZE_H // 2)
    overlay = pygame.Surface(panel.size, pygame.SRCALPHA)
    pygame.draw.rect(overlay, (*CARD, 235), overlay.get_rect(), border_radius=18)
    pygame.draw.rect(overlay, GOLD, overlay.get_rect(), 2, border_radius=18)

    heading = big_font.render("MAZE CLEARED!", True, GOLD)
    overlay.blit(heading, heading.get_rect(center=(panel.width // 2, 55)))
    points_surf = value_font.render(f"+{points} POINTS", True, GOAL_COLOR)
    overlay.blit(points_surf, points_surf.get_rect(center=(panel.width // 2, 112)))
    info = small_font.render(f"Time {run_time:.1f}s   |   Total score {score}", True, MUTED)
    overlay.blit(info, info.get_rect(center=(panel.width // 2, 152)))
    next_surf = body_font.render(f"NEXT: {next_label}", True, WALL_EDGE)
    overlay.blit(next_surf, next_surf.get_rect(center=(panel.width // 2, 190)))

    overlay.set_alpha(alpha)
    surf.blit(overlay, panel)


def apply_theme(stage):
    global WALL_EDGE, WALL_FILL, FLOOR_COLOR, FLOOR_ALT, GOAL_COLOR, background, maze_surface
    theme = THEMES[(stage - 1) % len(THEMES)]
    WALL_EDGE = theme["edge"]
    WALL_FILL = theme["fill"]
    FLOOR_COLOR = theme["floor"]
    FLOOR_ALT = theme["floor_alt"]
    GOAL_COLOR = theme["goal"]
    background = build_background(stage, theme["name"])
    maze_surface = build_maze_surface()
    return theme["name"]


def spawn_confetti(x, y):
    colors = [GOLD, GOAL_COLOR, WALL_EDGE, ROBOT_EYE, ROBOT_BODY]
    for _ in range(80):
        angle = random.uniform(0, 2 * math.pi)
        speed = random.uniform(80, 340)
        particles.append([x, y, math.cos(angle) * speed, math.sin(angle) * speed - 150,
                          random.choice(colors), random.uniform(0.8, 1.6)])


def update_confetti(surf, dt):
    for p in particles:
        p[3] += 420 * dt
        p[0] += p[2] * dt
        p[1] += p[3] * dt
        p[5] -= dt
        if p[5] > 0:
            pygame.draw.rect(surf, p[4], (p[0], p[1], 5, 5))
    particles[:] = [p for p in particles if p[5] > 0]


# ==========================================
# 5. MAIN GAME LOOP
# ==========================================
cam_rect = pygame.Rect(PANEL_X, MAZE_Y, CAM_W, CAM_H)
stats_rect = pygame.Rect(PANEL_X, cam_rect.bottom + 14, PANEL_W, 92)
controls_rect = pygame.Rect(PANEL_X, stats_rect.bottom + 14, PANEL_W, MAZE_Y + MAZE_H - stats_rect.bottom - 14)

cam_mask = pygame.Surface((CAM_W, CAM_H), pygame.SRCALPHA)
pygame.draw.rect(cam_mask, (255, 255, 255, 255), cam_mask.get_rect(), border_radius=14)

stage = 1
theme_name = apply_theme(stage)
game_surface = pygame.Surface((MAZE_W, MAZE_H))
gesture_filter = GestureFilter()
particles = []

player_tile = start_tile
player_pos = tile_center(start_tile)
target_tile = None
move_dir = (0, 0)
facing = (0, 1)

score = 0
completions = 0
best_time = None
last_points = 0
last_time = 0.0
run_start = None
win_timer = 0.0
WIN_SHOW_TIME = 2.5

running = True
while running:
    dt = min(clock.tick(60) / 1000, 0.1)

    # A. Handle GUI Events
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
        elif event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
            running = False

    # B. Process Camera Frame
    success, frame = cap.read()
    hand = None
    if success:
        frame = cv2.flip(frame, 1)
        results = hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        if results.multi_hand_landmarks:
            hand = results.multi_hand_landmarks[0]
            mp_draw.draw_landmarks(frame, hand, mp_hands.HAND_CONNECTIONS)

    # C. Gesture -> desired direction
    gesture = gesture_filter.update(hand)
    want = DIRECTIONS.get(gesture)
    if want is None:
        keys = pygame.key.get_pressed()
        for key, direction in KEY_DIRECTIONS.items():
            if keys[key]:
                want = direction
                break
    if want:
        facing = want

    # D. Tile-to-tile movement (can't snag on corners)
    def can_move(tile, direction):
        return not is_wall(tile[0] + direction[1], tile[1] + direction[0])

    def next_tile(tile, direction):
        return (tile[0] + direction[1], tile[1] + direction[0])

    if target_tile is not None and want == (-move_dir[0], -move_dir[1]):
        player_tile, target_tile = target_tile, player_tile
        move_dir = want
    if target_tile is None and want and can_move(player_tile, want):
        target_tile = next_tile(player_tile, want)
        move_dir = want
        if run_start is None:
            run_start = pygame.time.get_ticks()

    reached_goal = False
    if target_tile is not None:
        tx, ty = tile_center(target_tile)
        dist = math.hypot(tx - player_pos[0], ty - player_pos[1])
        step = MOVE_SPEED * dt
        if step >= dist:
            player_pos = [tx, ty]
            player_tile = target_tile
            target_tile = None
            if player_tile == end_tile:
                reached_goal = True
            elif want and can_move(player_tile, want):
                target_tile = next_tile(player_tile, want)
                move_dir = want
        else:
            player_pos[0] += (tx - player_pos[0]) / dist * step
            player_pos[1] += (ty - player_pos[1]) / dist * step
    moving = target_tile is not None

    elapsed = (pygame.time.get_ticks() - run_start) / 1000 if run_start else 0.0

    # Check for win condition
    if reached_goal:
        # 100 for finishing plus up to 200 bonus, losing 2 points per second
        last_points = 100 + max(0, 200 - int(elapsed) * 2)
        last_time = elapsed
        score += last_points
        completions += 1
        if best_time is None or elapsed < best_time:
            best_time = elapsed
        print(f"You Win! +{last_points} points in {elapsed:.1f}s (total {score})")
        stage += 1
        theme_name = apply_theme(stage)
        spawn_confetti(*end_rect.center)
        win_timer = WIN_SHOW_TIME
        player_tile = start_tile
        player_pos = tile_center(start_tile)
        target_tile = None
        run_start = None
        elapsed = 0.0

    # E. Render
    t = pygame.time.get_ticks() / 1000
    screen.blit(background, (0, 0))

    game_surface.blit(maze_surface, (0, 0))
    draw_goal(game_surface, t)
    draw_character(game_surface, player_pos, facing, moving, t)
    update_confetti(game_surface, dt)
    if win_timer > 0:
        win_timer -= dt
        alpha = int(255 * min(1.0, win_timer / 0.4, (WIN_SHOW_TIME - win_timer) / 0.2))
        draw_win_overlay(game_surface, max(0, alpha), last_points, last_time, score,
                         f"STAGE {stage}  ·  {theme_name}")
    screen.blit(game_surface, (MAZE_X, MAZE_Y))

    draw_camera(frame if success else None, t)
    draw_stats(score, elapsed, best_time, completions)
    draw_controls(gesture, gesture_filter, want)

    pygame.display.flip()

# ==========================================
# 6. CLEANUP
# ==========================================
cap.release()
pygame.quit()
sys.exit()
