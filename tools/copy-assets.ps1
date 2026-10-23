# Copies the subset of Minecraft textures used by the voxel game out of the
# downloaded client asset pack and into ./assets so the game folder is standalone.
$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$pack    = Join-Path $root 'minecraft-assets-26.3'
$texRoot = Join-Path $pack 'assets\minecraft\textures'
$dest    = Join-Path $root 'assets'

$blockDir = Join-Path $dest 'textures\blocks'
$itemDir  = Join-Path $dest 'textures\items'
$guiDir   = Join-Path $dest 'textures\gui'
$fontDir  = Join-Path $dest 'font'

foreach ($d in @($blockDir, $itemDir, $guiDir, $fontDir)) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

function Copy-Set {
    param([string]$SourceDir, [string]$TargetDir, [string[]]$Names)
    $copied = 0
    foreach ($n in $Names) {
        $src = Join-Path $SourceDir "$n.png"
        $leaf = Split-Path -Leaf $n
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $TargetDir "$leaf.png") -Force
            $copied++
        } else {
            Write-Host "  MISSING: $n"
        }
    }
    Write-Host ("  {0}/{1} copied" -f $copied, $Names.Count)
}

$blocks = @(
    'grass_block_top','grass_block_side','dirt','coarse_dirt','podzol_top','mycelium_top','rooted_dirt',
    'farmland','stone','cobblestone','mossy_cobblestone','stone_bricks','bricks','bedrock',
    'sand','red_sand','sandstone_top','sandstone','gravel','clay','terracotta',
    'coal_ore','iron_ore','gold_ore','diamond_ore','emerald_ore','redstone_ore','lapis_ore',
    'deepslate','cobbled_deepslate','deepslate_diamond_ore','deepslate_iron_ore','deepslate_gold_ore',
    'deepslate_coal_ore','deepslate_copper_ore','deepslate_emerald_ore','deepslate_lapis_ore',
    'deepslate_redstone_ore',
    'obsidian','ice','packed_ice','blue_ice',    'snow','glass','glowstone','water_still','lava_still','coal_block',
    'oak_log','oak_log_top','oak_planks','oak_leaves','birch_log','birch_log_top','birch_planks','birch_leaves',
    'spruce_log','spruce_log_top','spruce_planks','spruce_leaves',
    'crafting_table_top','crafting_table_side','crafting_table_front',
    'furnace_top','furnace_side','furnace_front','furnace_front_on',
    # cactus_bottom is there because the block declares a bottom face, and a face
    # the pack cannot supply is a 404 at boot rather than a flat colour
    'cactus_top','cactus_side','cactus_bottom','pumpkin_top','pumpkin_side','hay_block_top','hay_block_side',
    'iron_block','gold_block','diamond_block','emerald_block','lapis_block',
    'short_grass','fern','dead_bush','poppy','dandelion','cornflower','oxeye_daisy',
    'oak_sapling','birch_sapling','spruce_sapling','sugar_cane',
    'destroy_stage_0','destroy_stage_1','destroy_stage_2','destroy_stage_3','destroy_stage_4',
    'destroy_stage_5','destroy_stage_6','destroy_stage_7','destroy_stage_8','destroy_stage_9',
    'torch','glass_pane_top','chiseled_stone_bricks','smooth_stone','bamboo_fence',
    'moss_block',
    'command_block_front','command_block_side','command_block_back','structure_block',

    # --- the End ---
    'end_stone',
    'end_portal_frame_top','end_portal_frame_side','end_portal_frame_eye',
    'end_rod',

    # --- the Nether ---
    # The portal sheet is a 16 x 512 strip of 32 animation frames. The game cuts
    # eight of them into a 4 x 2 frame sheet at load time (see ShapeTextures.js),
    # so the whole strip is copied here and trimmed in the browser.
    'netherrack','nether_bricks','chiseled_nether_bricks','cracked_nether_bricks','red_nether_bricks',
    'ancient_debris_top','ancient_debris_side',
    'nether_gold_ore','nether_quartz_ore',
    'soul_sand','soul_soil','magma',
    'quartz_block_top','quartz_block_side','quartz_block_bottom',
    'basalt_top','basalt_side','smooth_basalt','polished_basalt_top','polished_basalt_side',
    'blackstone','shroomlight','nether_portal'
)

$items = @(
    'stick','coal','charcoal',    'iron_ingot','gold_ingot','diamond','emerald','redstone','lapis_lazuli',
    'netherite_ingot','raw_iron','raw_gold','raw_copper','iron_nugget','gold_nugget','brick','clay_ball','flint',
    'netherite_scrap',
    'string','feather','leather','bone','bone_meal','gunpowder','gunpowder','slime_ball',
    'apple','bread','golden_apple','melon_slice','sweet_berries','cookie','pumpkin_pie','mushroom_stew',
    'cooked_chicken',
    'beef','cooked_beef','porkchop','cooked_porkchop','chicken','cooked_chicken','mutton','cooked_mutton',
    'wheat','wheat_seeds','sugar','paper','book','shears','bucket','water_bucket','lava_bucket','bowl',
    'wooden_pickaxe','wooden_axe','wooden_shovel','wooden_sword','wooden_hoe',
    'stone_pickaxe','stone_axe','stone_shovel','stone_sword','stone_hoe',
    'iron_pickaxe','iron_axe','iron_shovel','iron_sword','iron_hoe',
    'diamond_pickaxe','diamond_axe','diamond_shovel','diamond_sword','diamond_hoe',
    'flint_and_steel','torchflower_seeds','honeycomb','honey_bottle','egg','ender_pearl','ender_eye','blaze_rod',
    'glowstone_dust','quartz','amethyst_shard','copper_ingot',
    'leather_helmet','leather_chestplate','leather_leggings','leather_boots',
    'iron_helmet','iron_chestplate','iron_leggings','iron_boots',
    'diamond_helmet','diamond_chestplate','diamond_leggings','diamond_boots'
)

$gui = @(
    'hud\crosshair','hud\hotbar','hud\hotbar_selection','hud\armor_full','hud\armor_half','hud\armor_empty',
    'hud\food_full','hud\food_half','hud\food_empty','hud\food_full_hunger','hud\food_half_hunger','hud\food_empty_hunger',
    'hud\air','hud\air_bursting','hud\air_empty',
    'hud\experience_bar_background','hud\experience_bar_progress',
    'widget\button','widget\button_highlighted','widget\button_disabled',
    'widget\slot_frame','container\slot',
    'tooltip\background'
)

Write-Host 'blocks:'
Copy-Set (Join-Path $texRoot 'block') $blockDir $blocks

# --- the warped cactus -------------------------------------------------------
# The Nether's own cactus: the pack's cactus textures with the hue
# rotated 150 degrees, which turns the green (~120°) purple (~270°).
# The originals are only ever read; the recolored copies are written
# under their own names so the registry can ask for them like any other
# tile. `Add-Type` is called here rather than assumed to have run,
# because the script's only other use of System.Drawing sits inside the
# autosave block below, which a missing source file skips.
Add-Type -AssemblyName System.Drawing
foreach ($n in @('cactus_top', 'cactus_side', 'cactus_bottom')) {
    $src = Join-Path $blockDir "$n.png"
    $dst = Join-Path $blockDir "warped_$n.png"
    if (-not (Test-Path -LiteralPath $src)) {
        Write-Host "  MISSING: $n (warped copy skipped)"
        continue
    }
    $bmp = New-Object System.Drawing.Bitmap $src
    for ($y = 0; $y -lt $bmp.Height; $y++) {
        for ($x = 0; $x -lt $bmp.Width; $x++) {
            $c = $bmp.GetPixel($x, $y)
            # transparent pixels stay transparent: the cactus sheets
            # carry their shape in the alpha channel
            if ($c.A -eq 0) { continue }
            # RGB -> HSV
            $r = $c.R / 255.0; $g = $c.G / 255.0; $b = $c.B / 255.0
            $mx = [Math]::Max($r, [Math]::Max($g, $b))
            $mn = [Math]::Min($r, [Math]::Min($g, $b))
            $d = $mx - $mn
            $h = 0.0
            if ($d -gt 0) {
                if ($mx -eq $r) { $h = 60.0 * ((($g - $b) / $d) % 6.0) }
                elseif ($mx -eq $g) { $h = 60.0 * ((($b - $r) / $d) + 2.0) }
                else { $h = 60.0 * ((($r - $g) / $d) + 4.0) }
            }
            if ($h -lt 0) { $h = $h + 360.0 }
            $s = 0.0; if ($mx -gt 0) { $s = $d / $mx }
            $v = $mx
            # the rotation itself: green -> purple
            $h = ($h + 150.0) % 360.0
            # HSV -> RGB
            $ch = $s * $v
            $x2 = $ch * (1.0 - [Math]::Abs(($h / 60.0) % 2.0 - 1.0))
            $m2 = $v - $ch
            $nr = 0.0; $ng = 0.0; $nb = 0.0
            switch ([Math]::Floor($h / 60.0)) {
                0 { $nr = $ch; $ng = $x2 }
                1 { $nr = $x2; $ng = $ch }
                2 { $ng = $ch; $nb = $x2 }
                3 { $ng = $x2; $nb = $ch }
                4 { $nr = $x2; $nb = $ch }
                default { $nr = $ch; $nb = $x2 }
            }
            $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(
                $c.A,
                [byte]([Math]::Round(($nr + $m2) * 255.0)),
                [byte]([Math]::Round(($ng + $m2) * 255.0)),
                [byte]([Math]::Round(($nb + $m2) * 255.0))))
        }
    }
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  blocks/warped_$n.png (hue-rotated from $n.png)"
}

# Two files the game needs under a name of its own:
#   - ancient debris has no item icon in the pack; its item model points straight
#     at the block's own side texture, exactly as the real game does
#   - fire is a 16 x 512 strip of 32 animation frames, not a 16x16 block face.
#     The game cuts one frame out of it at load time, but it is copied under the
#     plain block name so the registry can ask for it like any other tile.
Copy-Item -LiteralPath (Join-Path $texRoot 'block\ancient_debris_side.png') `
      -Destination (Join-Path $itemDir 'ancient_debris.png') -Force
Write-Host '  item/ancient_debris.png (from block/ancient_debris_side.png) copied'
Copy-Item -LiteralPath (Join-Path $texRoot 'block\fire_0.png') `
      -Destination (Join-Path $blockDir 'fire.png') -Force
Write-Host '  blocks/fire.png (from block/fire_0.png) copied'
# End portal texture is in entity folder, not block
Copy-Item -LiteralPath (Join-Path $texRoot 'entity\end_portal\end_portal.png') `
      -Destination (Join-Path $blockDir 'end_portal.png') -Force
Write-Host '  blocks/end_portal.png (from entity/end_portal/end_portal.png) copied'

Write-Host 'items:'
Copy-Set (Join-Path $texRoot 'item') $itemDir $items
Write-Host 'gui:'
Copy-Set (Join-Path $texRoot 'gui\sprites') $guiDir $gui

# --- title panorama ---------------------------------------------------------
# The six faces of the rotating cube plus the light-map overlay. Copied under
# assets/textures/gui/title/background so TitlePanorama can load them directly.
$panoramaSrc = Join-Path $texRoot 'gui\title\background'
$panoramaDir = Join-Path $dest 'textures\gui\title\background'
if (-not (Test-Path -LiteralPath $panoramaDir)) {
    New-Item -ItemType Directory -Path $panoramaDir -Force | Out-Null
}
foreach ($n in @('panorama_0','panorama_1','panorama_2','panorama_3','panorama_4','panorama_5')) {
    $src = Join-Path $panoramaSrc "$n.png"
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $panoramaDir "$n.png") -Force
    } else {
        Write-Host "  MISSING: $n"
    }
}
# the overlay is optional: only some packs supply it
$overlaySrc = Join-Path $panoramaSrc 'panorama_overlay.png'
if (Test-Path -LiteralPath $overlaySrc) {
    Copy-Item -LiteralPath $overlaySrc -Destination (Join-Path $panoramaDir 'panorama_overlay.png') -Force
    Write-Host '  gui/title/background/panorama_overlay.png copied'
}
Write-Host '  gui/title/background: panorama faces copied'

# --- the autosave indicator --------------------------------------------------------
# The Bedrock autosave indicator, which is a strip of nine 19x31 frames of an
# arrow stepping down into a chest. It is not in the Java pack's gui folder, so it
# is kept in the repository next to the pack rather than being pulled from it.
#
# The sheet is ripped, and it carries a one pixel blue guide (36, 92, 198) along
# the top and left of every cell. Left in, that reads as a blue border drawn over
# the icon, because the real game masks its cell guides out and a ripped sheet does
# not come with the mask. So the guide is cut off here and the frames are laid out
# again as a clean 18x30 strip.
#
# Rows 0-30 are the icon; everything below is the sheet author's caption, which is
# not part of the icon and does not belong in the game's interface. The credit is
# reproduced in the changelog instead.
$autosaveSrc = Join-Path $root 'PC _ Computer - Minecraft_ Bedrock Edition - UI Elements - Autosave Indicator.png'
$autosaveDst = Join-Path $guiDir 'autosave.png'
if (Test-Path -LiteralPath $autosaveSrc) {
    Add-Type -AssemblyName System.Drawing
    $sheet = [System.Drawing.Bitmap]::FromFile($autosaveSrc)
    $cellW = 19; $cellH = 31; $frames = 9
    $outW = ($cellW - 1) * $frames
    $outH = $cellH - 1
    $strip = New-Object System.Drawing.Bitmap $outW, $outH
    $g = [System.Drawing.Graphics]::FromImage($strip)
    $g.InterpolationMode = 'NearestNeighbor'
    $g.PixelOffsetMode = 'Half'
    $g.Clear([System.Drawing.Color]::Transparent)
    # draw each cell's interior - one pixel in from the top and left - in turn
    $inner = $cellW - 1
    for ($i = 0; $i -lt $frames; $i++) {
        $srcX = $i * $cellW + 1
        $dstX = $i * $inner
        $src = [System.Drawing.Rectangle]::new($srcX, 1, $inner, $cellH - 1)
        $dst = [System.Drawing.Rectangle]::new($dstX, 0, $inner, $cellH - 1)
        $g.DrawImage($sheet, $dst, $src, [System.Drawing.GraphicsUnit]::Pixel)
    }
    $g.Dispose()
    $strip.Save($autosaveDst, [System.Drawing.Imaging.ImageFormat]::Png)
    $strip.Dispose()
    $sheet.Dispose()
    Write-Host "  gui/autosave.png $outW x $outH ($frames frames of $($cellW - 1)x$($cellH - 1), guide removed)"
}

# --- the app icon -----------------------------------------------------------------
# The pack already ships the finished Minecraft icon at every size an .ico needs.
# There is nothing to draw, crop, resample or invent: copy them, and `npm run
# icon` wraps them in a container. The snapshot/ subfolder is a second take of the
# same thing and is deliberately left alone.
Write-Host 'icons:'
$iconDir = Join-Path $dest 'icons'
if (-not (Test-Path -LiteralPath $iconDir)) { New-Item -ItemType Directory -Path $iconDir -Force | Out-Null }
# the icons sit beside `minecraft` in the pack, not inside it, so this is the one
# place that does not go through $texRoot / $pack
Copy-Set (Join-Path $root 'minecraft-assets-26.3\assets\icons') $iconDir @(
    'icon_16x16', 'icon_32x32', 'icon_48x48', 'icon_128x128', 'icon_256x256'
) 'icons'

# --- mobs ----------------------------------------------------------------------
# The chicken artwork. The pack ships this as a 64x32 entity UV map but not the
# model it belongs to - vanilla defines the chicken's boxes in code, not in a model
# file - so it is worn whole as a billboard rather than mapped onto boxes whose UVs
# nothing in the pack says.
$chickenSkin = Join-Path $root 'minecraft-assets-26.3\assets\minecraft\textures\entity\chicken\chicken_temperate.png'
if (Test-Path -LiteralPath $chickenSkin) {
    $chickenDir = Join-Path $dest 'textures\entity\chicken'
    if (-not (Test-Path -LiteralPath $chickenDir)) {
        New-Item -ItemType Directory -Path $chickenDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $chickenSkin -Destination (Join-Path $chickenDir 'chicken_temperate.png') -Force
    Write-Host '  textures/entity/chicken/chicken_temperate.png copied'
}

# The pig artwork, adult and baby. The pack ships both skins but, like the
# chicken, no model files - the pig's boxes come from `pig.glb` /
# `pig_baby.glb` in the project, and the baby's 32x32 sheet is the one the
# piglet's quads are read out of.
$entity = Join-Path $texRoot 'entity'
foreach ($skin in @(
    'pig\pig_temperate.png',
    'pig\pig_temperate_baby.png'
)) {
    $src = Join-Path $entity $skin
    $leaf = Split-Path -Leaf $skin
    $dir = Join-Path $dest "textures\entity\$(Split-Path $skin -Parent)"
    if (Test-Path -LiteralPath $src) {
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Copy-Item -LiteralPath $src -Destination (Join-Path $dir $leaf) -Force
        Write-Host "  textures/entity/$skin copied"
    }
}

# Bitmap font sheet used for authentic Minecraft text rendering
$fontSrc = Join-Path $texRoot 'font\ascii.png'
if (Test-Path -LiteralPath $fontSrc) {
    Copy-Item -LiteralPath $fontSrc -Destination (Join-Path $fontDir 'ascii.png') -Force
    Write-Host '  font/ascii.png copied'
}

# Cloud sheet for the sky layer
$cloudSrc = Join-Path $texRoot 'environment\clouds.png'
if (Test-Path -LiteralPath $cloudSrc) {
    Copy-Item -LiteralPath $cloudSrc -Destination (Join-Path $dest 'textures\clouds.png') -Force
    Write-Host '  textures/clouds.png copied'
}

$total = (Get-ChildItem -Recurse -File -LiteralPath $dest | Measure-Object).Count
Write-Host "done. $total files in assets/"
