# Copies the Minecraft sound effects and music used by the game out of the
# downloaded client asset pack and into ./assets/sounds so the game folder is
# standalone. SFX are tiny (a few KB each) so they are all copied; music tracks
# are multi megabyte so only a handful are taken.
$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$pack    = Join-Path $root 'minecraft-assets-26.3\assets\minecraft\sounds'
$dest    = Join-Path $root 'assets\sounds'

foreach ($d in @('dig', 'step', 'random', 'ui', 'damage', 'liquid', 'item', 'ambient', 'ambient\cave',
                 'ambient\underwater', 'ambient\weather', 'music',
                 'block\deepslate', 'block\chest', 'block\furnace', 'block\bone_block',
                 'block\deadbush', 'block\vine', 'block\sand', 'block\iron',
                 'block\end_portal', 'portal',
                 'mob\chicken', 'mob\pig', 'mob\pig\baby_pig',
                 'ui\loom', 'ui\toast', 'ui\hud')) {
    $p = Join-Path $dest $d
    if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}

function Copy-Set {
    param([string]$SourceDir, [string]$TargetDir, [string[]]$Names, [string]$Label)
    $copied = 0
    foreach ($n in $Names) {
        $src = Join-Path $SourceDir "$n.ogg"
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $TargetDir "$n.ogg") -Force
            $copied++
        } else {
            Write-Host "  MISSING: $SourceDir\$n.ogg"
        }
    }
    Write-Host ("  {0}: {1}/{2}" -f $Label, $copied, $Names.Count)
}

# --- digging / mining ticks and footsteps, per material group -------------
$materials = @('stone', 'wood', 'grass', 'gravel', 'sand', 'snow', 'cloth')
foreach ($m in $materials) {
    $dig = 1..4 | ForEach-Object { "$m$_" }
    Copy-Set (Join-Path $pack 'dig') (Join-Path $dest 'dig') $dig "dig/$m"
    $step = 1..6 | ForEach-Object { "$m$_" }
    Copy-Set (Join-Path $pack 'step') (Join-Path $dest 'step') $step "step/$m"
}
Copy-Set (Join-Path $pack 'step') (Join-Path $dest 'step') @('ladder1', 'ladder2') 'step/ladder'

# --- generic one-shots ----------------------------------------------------
Copy-Set (Join-Path $pack 'random') (Join-Path $dest 'random') @(
    'click', 'orb', 'pop', 'levelup', 'burp', 'fizz', 'fuse', 'break',
    'glass1', 'glass2', 'glass3', 'drink', 'eat1', 'eat2', 'eat3',
    'splash', 'wood_click', 'successful_hit', 'classic_hurt', 'explode1', 'explode2'
) 'random'
Copy-Set (Join-Path $pack 'ui\loom') (Join-Path $dest 'ui\loom') @('take_result1', 'take_result2') 'ui/loom'
Copy-Set (Join-Path $pack 'ui\toast') (Join-Path $dest 'ui\toast') @('in', 'out', 'challenge_complete') 'ui/toast'
Copy-Set (Join-Path $pack 'ui\hud') (Join-Path $dest 'ui\hud') @('hud_bubble') 'ui/hud'
Copy-Set (Join-Path $pack 'damage') (Join-Path $dest 'damage') @(
    'hit1', 'hit2', 'hit3', 'fallbig', 'fallsmall'
) 'damage'
Copy-Set (Join-Path $pack 'liquid') (Join-Path $dest 'liquid') @(
    'splash', 'splash2', 'heavy_splash', 'swim1', 'swim2', 'swim3', 'lava', 'water'
) 'liquid'

# --- per block overrides --------------------------------------------------
Copy-Set (Join-Path $pack 'block\deepslate') (Join-Path $dest 'block\deepslate') @(
    'break1', 'break2', 'break3', 'break4', 'place1', 'place2', 'place3', 'place4', 'step1', 'step2'
) 'block/deepslate'
Copy-Set (Join-Path $pack 'block\chest') (Join-Path $dest 'block\chest') @('open', 'close1', 'close2') 'block/chest'
Copy-Set (Join-Path $pack 'block\furnace') (Join-Path $dest 'block\furnace') @(
    'fire_crackle1', 'fire_crackle2', 'fire_crackle3') 'block/furnace'
Copy-Set (Join-Path $pack 'block\bone_block') (Join-Path $dest 'block\bone_block') @(
    'break1', 'break2', 'step1', 'step2') 'block/bone_block'
Copy-Set (Join-Path $pack 'block\deadbush\sandblock_version') (Join-Path $dest 'block\deadbush') @('bushrustle1', 'bushrustle2', 'creakysand1') 'block/deadbush'
Copy-Set (Join-Path $pack 'block\vine') (Join-Path $dest 'block\vine') @('break1', 'break2', 'climb1', 'climb2') 'block/vine'
Copy-Set (Join-Path $pack 'block\sand') (Join-Path $dest 'block\sand') @('sand1', 'sand2', 'sand3', 'sand4', 'sand5') 'block/sand'
Copy-Set (Join-Path $pack 'block\iron') (Join-Path $dest 'block\iron') @('step1', 'step2', 'step3', 'step4') 'block/iron'

# --- mobs ----------------------------------------------------------------------
# The chicken is the first mob in the game. Its whole voice is these nine files:
# a plop when it lands, three idle clucks, two hurt squawks, two steps and a
# death squawk.
Copy-Set (Join-Path $pack 'mob\chicken') (Join-Path $dest 'mob\chicken') @(
    'plop', 'say1', 'say2', 'say3', 'hurt1', 'hurt2', 'step1', 'step2'
) 'mob/chicken'

# The pig. A grunt rather than a cluck: three of them, five footstep
# recordings, a pair of eating sounds and a death. Vanilla has no dedicated
# hurt file for a pig - the game reuses one of the idle grunts - which is why
# there are no hurt files to copy.
Copy-Set (Join-Path $pack 'mob\pig') (Join-Path $dest 'mob\pig') @(
    'say1', 'say2', 'say3', 'step1', 'step2', 'step3', 'step4', 'step5',
    'eat1', 'eat2', 'death'
) 'mob/pig'

# And the piglet, which like the chick is a different mob rather than a small
# pig: the pack gives it its own voice under baby_pig, six idle grunts, three
# hit sounds where the adult has none of its own, and the full five footsteps.
Copy-Set (Join-Path $pack 'mob\pig\baby_pig') (Join-Path $dest 'mob\pig\baby_pig') @(
    'ambient1', 'ambient2', 'ambient3', 'ambient4', 'ambient5', 'ambient6',
    'hit1', 'hit2', 'hit3',
    'step1', 'step2', 'step3', 'step4', 'step5'
) 'mob/pig/baby_pig'

# --- portals -----------------------------------------------------------------
# The pack has no block/portal/trigger or block/portal/travel, so the two sounds
# a nether portal is given here are the closest it ships. block/end_portal is
# the long descending whoosh the real game uses when a player goes through one,
# and it is the whole of the feedback for a dimension change - there is no chat
# line for it, in this game or in the real one.
Copy-Set (Join-Path $pack 'block\end_portal') (Join-Path $dest 'block\end_portal') @('endportal') 'block/end_portal'

# The hum of a lit portal: a five second file meant to be looped, which is what
# the real game plays whenever a player is near an active one.
Copy-Set (Join-Path $pack 'portal') (Join-Path $dest 'portal') @('portal') 'portal'

# --- ambience -------------------------------------------------------------
Copy-Set (Join-Path $pack 'ambient\cave') (Join-Path $dest 'ambient\cave') @(
    'cave1', 'cave5', 'cave9', 'cave14', 'cave19', 'cave23') 'ambient/cave'
foreach ($n in @('ambience', 'underwater_ambience')) {
    $src = Join-Path $pack "ambient\underwater\$n.ogg"
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $dest "ambient\underwater\$n.ogg") -Force
    }
}
# (no weather system in this build, so no rain/wind files are copied)

# --- music ----------------------------------------------------------------
Copy-Set (Join-Path $pack 'music\game') (Join-Path $dest 'music') @(
    'minecraft'            # main menu theme
) 'music/menu'
Copy-Set (Join-Path $pack 'music\game') (Join-Path $dest 'music') @(
    'a_familiar_room', 'dry_hands', 'wet_hands', 'oxygene', 'sweden', 'key'
) 'music/game'

$files = Get-ChildItem -Recurse -File -LiteralPath $dest
$bytes = ($files | Measure-Object -Property Length -Sum).Sum
Write-Host ("done. {0} files, {1:N1} MB" -f $files.Count, ($bytes / 1mb))
