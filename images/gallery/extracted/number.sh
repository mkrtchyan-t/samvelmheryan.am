#!/bin/bash

# Directory containing the images
dir_path="./"

# Counter for naming
index=1

# Loop through each image file in the directory
for file in "$dir_path"*.jpg "$dir_path"*.JPG; do
    # Only process if the file exists (because of the multiple wildcards)
    if [[ -e "$file" ]]; then
        # Get the file extension
        ext="${file##*.}"
        
        # Rename the file using the counter value and the original file extension
        mv "$file" "$dir_path""$index.jpg"
        
        # Increment the counter
        ((index++))
    fi
done

