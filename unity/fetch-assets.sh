#!/usr/bin/env bash
#
# Fetch the CC0 KayKit character models the Unity edition uses. The .fbx files
# (~20 MB each, they embed 76 animations) are not committed; this pulls them
# from the KayKit GitHub mirrors into Assets/Resources/KayKit/.
#
# Run once after cloning, before building the Unity project:
#   bash unity/fetch-assets.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DST="$HERE/ClashRoyaleUnity/Assets/Resources/KayKit"
mkdir -p "$DST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Cloning KayKit packs (CC0)…"
git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0.git "$TMP/adv"
git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0.git "$TMP/skel"

ADV="$TMP/adv/addons/kaykit_character_pack_adventures"
SKEL="$TMP/skel/addons/kaykit_character_pack_skeletons"

for m in Knight Mage Rogue Barbarian; do
  cp "$ADV/Characters/fbx/$m.fbx" "$DST/$m.fbx"
done
cp "$SKEL/Characters/fbx/Skeleton_Minion.fbx" "$DST/Skeleton.fbx"

# Textures (also committed, copied here for a clean fresh checkout).
cp "$ADV/Textures/knight_texture.png" "$DST/"
cp "$ADV/Textures/mage_texture.png" "$DST/"
cp "$ADV/Textures/rogue_texture.png" "$DST/"
cp "$ADV/Textures/barbarian_texture.png" "$DST/"
cp "$SKEL/Textures/skeleton_texture.png" "$DST/"
cp "$TMP/adv/LICENSE.txt" "$DST/KayKit-LICENSE.txt"

echo "Done. KayKit models are in $DST"
