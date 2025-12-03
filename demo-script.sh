#!/bin/bash
# OpenAI Image & Video API Demo Script
# Run with: asciinema rec -c "./demo-script.sh" demo.cast

set -e
cd /home/alexs/img-gen/openai-api

# Colors for visibility
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper to echo command before running
run() {
  echo -e "${YELLOW}\$ $@${NC}"
  "$@"
}

echo -e "${CYAN}=== OpenAI Image & Video API Demo ===${NC}"
sleep 2

#############################################
# Part 1: Introduction (20 seconds)
#############################################
clear
echo -e "${GREEN}# Show the CLI help${NC}"
sleep 1
run openai-img --help
sleep 4

echo ""
echo -e "${GREEN}# Show usage examples${NC}"
sleep 1
run openai-img --examples
sleep 6

#############################################
# Part 2: DALL-E Generation (40 seconds)
#############################################
clear
echo -e "${GREEN}# DALL-E 3 - High quality with HD${NC}"
sleep 1
run openai-img --dalle-3 \
  --prompt "A photorealistic image of an astronaut exploring an alien planet" \
  --size 1792x1024 \
  --quality hd \
  --style vivid
sleep 3

echo ""
echo -e "${GREEN}# DALL-E 3 - Natural style${NC}"
sleep 1
run openai-img --dalle-3 \
  --prompt "Minimalist Japanese garden with a zen rock arrangement" \
  --size 1024x1024 \
  --quality hd \
  --style natural
sleep 3

echo ""
echo -e "${GREEN}# Show generated images${NC}"
sleep 1
run tree datasets/ -L 3 -I '*.json' --noreport
sleep 3

#############################################
# Part 3: GPT Image 1 (35 seconds)
#############################################
clear
echo -e "${GREEN}# GPT Image 1 - Advanced generation${NC}"
sleep 1
run openai-img --gpt-image-1 \
  --prompt "A cute robot character mascot for a tech company" \
  --size 1024x1024 \
  --quality high \
  --output-format png
sleep 3

echo ""
echo -e "${GREEN}# GPT Image 1 - Transparent background${NC}"
sleep 1
run openai-img --gpt-image-1 \
  --prompt "A glowing crystal gemstone floating in air" \
  --background transparent \
  --output-format png \
  --quality high
sleep 3

echo ""
echo -e "${GREEN}# Show GPT Image results${NC}"
sleep 1
run tree datasets/ -L 3 -I '*.json' --noreport
sleep 3

#############################################
# Part 4: Sora Video Generation (45 seconds)
#############################################
clear
echo -e "${GREEN}# Sora 2 - Text-to-video${NC}"
sleep 1
run openai-img --video --sora-2 \
  --prompt "A cat walking gracefully across a sunlit windowsill" \
  --seconds 4 \
  --size 1280x720
sleep 3

echo ""
echo -e "${GREEN}# Sora 2 - Image-to-video animation${NC}"
sleep 1
GPT_IMG=$(ls -t datasets/openai/gpt-image-1/*.png 2>/dev/null | head -1)
echo -e "${YELLOW}\$ openai-img --video --sora-2 --input-image <latest-gpt-image> --prompt \"The robot waves hello\" --seconds 4${NC}"
openai-img --video --sora-2 \
  --input-image "$GPT_IMG" \
  --prompt "The robot character waves hello and blinks" \
  --seconds 4 \
  --size 1280x720
sleep 3

echo ""
echo -e "${GREEN}# Show all generated content${NC}"
sleep 1
run tree datasets/ -L 3 -I '*.json' --noreport
sleep 3

#############################################
# Part 5: Wrap-up (10 seconds)
#############################################
clear
echo ""
echo "================================================"
echo "   OpenAI Image & Video API"
echo "================================================"
echo ""
echo "  DALL-E 2:     Basic generation, editing, variations"
echo "  DALL-E 3:     HD quality, vivid/natural styles"
echo "  GPT Image 1:  Transparent BGs, multi-image editing"
echo "  Sora 2:       Text-to-video, image-to-video"
echo "  Sora 2 Pro:   Production quality videos"
echo ""
echo "  github.com/aself101/openai-image-api"
echo ""
echo "================================================"
sleep 5

echo ""
echo -e "${CYAN}Demo complete!${NC}"
