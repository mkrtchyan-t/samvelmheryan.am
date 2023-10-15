#!/bin/bash

# Directory containing the images
dir_path="./"

# Counter for naming
index=1

# Loop through each image file in the directory
for file in "$dir_path"*.jpg "$dir_path"*.JPG "$dir_path"*.jpeg; do
    # Only process if the file exists (because of the multiple wildcards)
    if [[ -e "$file" ]]; then
        # Get the file extension
        ext="${file##*.}"
        
        mv "$file" "$dir_path""tmp_$index.jpg"
        
        ((index++))
    fi
done

index=1
for file in "$dir_path"*.jpg "$dir_path"*.JPG "$dir_path"*.jpeg; do
    # Only process if the file exists (because of the multiple wildcards)
    if [[ -e "$file" ]]; then
        # Get the file extension
        ext="${file##*.}"
        
        mv "$file" "$dir_path""$index.jpg"
        
        ((index++))
    fi
done
