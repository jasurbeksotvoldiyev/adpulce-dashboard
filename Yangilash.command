#!/bin/bash
cd "$(dirname "$0")"
echo "AdPulce Agency dashboardi yangilanmoqda..."
echo ""
python3 update_dashboard.py
echo ""
echo "Dashboard brauzerda ochilmoqda..."
open "file://$(pwd)/index.html?t=$(date +%s)"
echo ""
echo "Tugadi! Bu oyna 3 soniyadan keyin o'zi yopiladi..."
sleep 3
