"""
Generates all brand assets and icons across Next.js Web App, PWA, and Android Capacitor.
Source: public/icons/uas-logo.png
Target backdrop: #0B1120 (rgb(11, 17, 32))
"""

import os
import math
from PIL import Image, ImageDraw

BG_COLOR = (11, 17, 32) # #0B1120

def create_seamless_logo(src_img):
    """
    Creates a copy of the logo where the outer perimeter smoothly blends into #0B1120.
    The center emblem is at radius ~0.65 of half-width, so fading from 0.75 to 1.0 ensures
    seamless integration on any #0B1120 canvas.
    """
    w, h = src_img.size
    rgba = src_img.convert("RGBA")
    alpha = Image.new("L", (w, h), 255)
    cx, cy = w / 2.0, h / 2.0
    max_r = min(cx, cy)
    r_start = max_r * 0.72
    r_end = max_r * 0.96

    # Build radial alpha mask
    # Fast numpy or pixel array
    try:
        import numpy as np
        y, x = np.ogrid[:h, :w]
        dist_from_center = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        # linear ramp from r_start (255) to r_end (0)
        ramp = 255.0 * (1.0 - (dist_from_center - r_start) / (r_end - r_start))
        ramp = np.clip(ramp, 0, 255).astype(np.uint8)
        alpha = Image.fromarray(ramp, mode="L")
    except ImportError:
        # Fallback without numpy
        pass

    rgba.putalpha(alpha)
    
    # Composite onto solid BG_COLOR
    base = Image.new("RGBA", (w, h), BG_COLOR + (255,))
    base.paste(rgba, (0, 0), rgba)
    return base

def make_circular(img):
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, w - 1, h - 1), fill=255)
    result = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    result.paste(img.convert("RGBA"), (0, 0), mask)
    return result

def generate_icons(repo_root):
    src_path = os.path.join(repo_root, "public", "icons", "uas-logo.png")
    if not os.path.exists(src_path):
        src_path = os.path.join(repo_root, "public", "uas-logo.png")
    
    print(f"Loading source logo from: {src_path}")
    raw_logo = Image.open(src_path)
    seamless_logo = create_seamless_logo(raw_logo)
    
    # 1. Save standard clean public/uas-logo.png (RGB PNG on #0B1120)
    pub_logo_path = os.path.join(repo_root, "public", "uas-logo.png")
    seamless_logo.convert("RGB").save(pub_logo_path, format="PNG", optimize=True)
    # Also overwrite public/icons/uas-logo.png as proper PNG
    seamless_logo.convert("RGB").save(os.path.join(repo_root, "public", "icons", "uas-logo.png"), format="PNG", optimize=True)
    print("Saved public/uas-logo.png")

    # 2. Web & PWA Icons
    web_icons = {
        os.path.join(repo_root, "public", "icons", "icon-192.png"): (192, 192),
        os.path.join(repo_root, "public", "icons", "icon-512.png"): (512, 512),
        os.path.join(repo_root, "public", "icons", "icon-192x192.png"): (192, 192),
        os.path.join(repo_root, "public", "icons", "icon-512x512.png"): (512, 512),
        os.path.join(repo_root, "public", "icons", "icon-maskable-512.png"): (512, 512),
        os.path.join(repo_root, "public", "icons", "icon.png"): (512, 512),
        os.path.join(repo_root, "public", "icons", "apple-touch-icon.png"): (180, 180),
        os.path.join(repo_root, "public", "icons", "apple-touch-icon-180x180.png"): (180, 180),
        os.path.join(repo_root, "public", "apple-touch-icon.png"): (180, 180),
        os.path.join(repo_root, "public", "favicon-32x32.png"): (32, 32),
        os.path.join(repo_root, "public", "favicon-16x16.png"): (16, 16),
    }

    for path, size in web_icons.items():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        resized = seamless_logo.resize(size, Image.Resampling.LANCZOS)
        resized.convert("RGB").save(path, format="PNG", optimize=True)
        print(f"Saved {os.path.relpath(path, repo_root)} ({size[0]}x{size[1]})")

    # Multi-resolution favicon.ico (16, 32, 48)
    fav_path = os.path.join(repo_root, "public", "favicon.ico")
    fav_16 = seamless_logo.resize((16, 16), Image.Resampling.LANCZOS).convert("RGBA")
    fav_32 = seamless_logo.resize((32, 32), Image.Resampling.LANCZOS).convert("RGBA")
    fav_48 = seamless_logo.resize((48, 48), Image.Resampling.LANCZOS).convert("RGBA")
    fav_48.save(fav_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print("Saved public/favicon.ico")

    # 3. Android Adaptive Launcher Icons
    densities = {
        "mipmap-mdpi": {"legacy": 48, "fg": 108},
        "mipmap-hdpi": {"legacy": 72, "fg": 162},
        "mipmap-xhdpi": {"legacy": 96, "fg": 216},
        "mipmap-xxhdpi": {"legacy": 144, "fg": 324},
        "mipmap-xxxhdpi": {"legacy": 192, "fg": 432},
    }

    res_base = os.path.join(repo_root, "android", "app", "src", "main", "res")

    for folder, dim in densities.items():
        dir_path = os.path.join(res_base, folder)
        os.makedirs(dir_path, exist_ok=True)
        leg_size = (dim["legacy"], dim["legacy"])
        fg_size = (dim["fg"], dim["fg"])

        # ic_launcher.png (legacy square)
        launcher_sq = seamless_logo.resize(leg_size, Image.Resampling.LANCZOS).convert("RGBA")
        launcher_sq.save(os.path.join(dir_path, "ic_launcher.png"), format="PNG", optimize=True)

        # ic_launcher_round.png (circular)
        launcher_round = make_circular(launcher_sq)
        launcher_round.save(os.path.join(dir_path, "ic_launcher_round.png"), format="PNG", optimize=True)

        # ic_launcher_foreground.png (108dp adaptive foreground)
        # Scaled to ~85% inside the fg canvas on #0B1120 background for seamless adaptive display
        fg_canvas = Image.new("RGBA", fg_size, BG_COLOR + (255,))
        logo_fg_dim = int(dim["fg"] * 0.85)
        logo_fg_resized = seamless_logo.resize((logo_fg_dim, logo_fg_dim), Image.Resampling.LANCZOS).convert("RGBA")
        offset = (dim["fg"] - logo_fg_dim) // 2
        fg_canvas.paste(logo_fg_resized, (offset, offset), logo_fg_resized)
        fg_canvas.save(os.path.join(dir_path, "ic_launcher_foreground.png"), format="PNG", optimize=True)

        print(f"Saved Android {folder} icons (legacy: {dim['legacy']}px, fg: {dim['fg']}px)")

    # 4. Android Splash Screens
    splashes = {
        os.path.join(res_base, "drawable", "splash.png"): (480, 320),
        os.path.join(res_base, "drawable-land-mdpi", "splash.png"): (480, 320),
        os.path.join(res_base, "drawable-land-hdpi", "splash.png"): (800, 480),
        os.path.join(res_base, "drawable-land-xhdpi", "splash.png"): (1280, 720),
        os.path.join(res_base, "drawable-land-xxhdpi", "splash.png"): (1600, 960),
        os.path.join(res_base, "drawable-land-xxxhdpi", "splash.png"): (1920, 1280),
        os.path.join(res_base, "drawable-port-mdpi", "splash.png"): (320, 480),
        os.path.join(res_base, "drawable-port-hdpi", "splash.png"): (480, 800),
        os.path.join(res_base, "drawable-port-xhdpi", "splash.png"): (720, 1280),
        os.path.join(res_base, "drawable-port-xxhdpi", "splash.png"): (960, 1600),
        os.path.join(res_base, "drawable-port-xxxhdpi", "splash.png"): (1280, 1920),
    }

    for path, (tw, th) in splashes.items():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # Create solid #0B1120 background canvas
        splash_img = Image.new("RGB", (tw, th), BG_COLOR)
        
        # Center the logo emblem at ~65% of the smaller dimension
        min_dim = min(tw, th)
        logo_size = int(min_dim * 0.65)
        resized_logo = seamless_logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS).convert("RGBA")
        
        pos_x = (tw - logo_size) // 2
        pos_y = (th - logo_size) // 2
        splash_img.paste(resized_logo, (pos_x, pos_y), resized_logo)
        splash_img.save(path, format="PNG", optimize=True)
        print(f"Saved splash: {os.path.relpath(path, repo_root)} ({tw}x{th})")

if __name__ == "__main__":
    repo = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    generate_icons(repo)
    # Also if E:\uas-accounting-system exists and is distinct, sync it
    alt_repo = "E:\\uas-accounting-system"
    if os.path.exists(alt_repo) and os.path.abspath(alt_repo) != repo:
        import shutil
        print(f"\nAlso syncing generated assets to alternate repo: {alt_repo}")
        # Copy public icons
        shutil.copy2(os.path.join(repo, "public", "uas-logo.png"), os.path.join(alt_repo, "public", "uas-logo.png"))
        shutil.copy2(os.path.join(repo, "public", "favicon.ico"), os.path.join(alt_repo, "public", "favicon.ico"))
        shutil.copy2(os.path.join(repo, "public", "favicon-32x32.png"), os.path.join(alt_repo, "public", "favicon-32x32.png"))
        shutil.copy2(os.path.join(repo, "public", "favicon-16x16.png"), os.path.join(alt_repo, "public", "favicon-16x16.png"))
        shutil.copy2(os.path.join(repo, "public", "apple-touch-icon.png"), os.path.join(alt_repo, "public", "apple-touch-icon.png"))
        
        alt_icons = os.path.join(alt_repo, "public", "icons")
        os.makedirs(alt_icons, exist_ok=True)
        for f in os.listdir(os.path.join(repo, "public", "icons")):
            shutil.copy2(os.path.join(repo, "public", "icons", f), os.path.join(alt_icons, f))
            
        # Copy android res
        alt_res = os.path.join(alt_repo, "android", "app", "src", "main", "res")
        if os.path.exists(alt_res):
            src_res = os.path.join(repo, "android", "app", "src", "main", "res")
            for root, dirs, files in os.walk(src_res):
                rel = os.path.relpath(root, src_res)
                target_dir = os.path.join(alt_res, rel)
                os.makedirs(target_dir, exist_ok=True)
                for file in files:
                    if file.endswith((".png", ".xml")):
                        shutil.copy2(os.path.join(root, file), os.path.join(target_dir, file))
        print("Synced to alternate repo successfully.")

