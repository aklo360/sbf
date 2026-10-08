#!/bin/bash

# Navigate to traits directory
cd public/img/traits

# For each subdirectory in traits
for dir in */; do
  cd "$dir"
  # For each PNG file in the subdirectory
  for file in *.png; do
    # Extract the part between the comma and the hash
    newname=$(echo "$file" | sed 's/^[^,]*,\(.*\)#.*\.png$/\1.png/')
    # Rename the file
    mv "$file" "$newname"
  done
  cd ..
done