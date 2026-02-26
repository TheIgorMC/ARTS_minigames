# -*- coding: utf-8 -*-

import numpy as np
from PIL import Image
import opensimplex
import math
import os

def generate_planet_maps(seed, base_name, width=1024, height=512, output_folder="out"):
    """
    Genera mappe procedurale (Diffuse, Bump, Specular) per un pianeta 
    e le salva nella cartella specificata (Compatibile con Python 2.7).
    """
    
    # 1. Crea la cartella di output se non esiste
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)
        print("Directory '{}' creata.".format(output_folder))

    print("Generazione pianeta '{}' con seed {}...".format(base_name, seed))
    
    # Inizializza il generatore di rumore
    opensimplex.seed(seed)
    
    # Pre-allochiamo le matrici
    bump_map = np.zeros((height, width), dtype=np.uint8)
    diffuse_map = np.zeros((height, width, 3), dtype=np.uint8)
    specular_map = np.zeros((height, width), dtype=np.uint8)
    
    sea_level = 0.55
    
    for y in range(height):
        # Grazie a 'from __future__ import division', questa sarà una divisione float corretta
        phi = math.pi * (y / height)
        
        for x in range(width):
            theta = 2 * math.pi * (x / width)
            
            nx = math.sin(phi) * math.cos(theta)
            ny = math.sin(phi) * math.sin(theta)
            nz = math.cos(phi)
            
            raw_noise = opensimplex.noise3(nx * 2.5, ny * 2.5, nz * 2.5)
            detail_noise = opensimplex.noise3(nx * 10, ny * 10, nz * 10) * 0.1
            
            final_noise = (raw_noise + detail_noise + 1) / 2.0
            final_noise = max(0.0, min(1.0, final_noise))
            
            # --- 1. BUMP MAP ---
            bump_map[y, x] = int(final_noise * 255)
            
            # --- 2. DIFFUSE & SPECULAR MAP ---
            if final_noise < sea_level:
                depth = final_noise / sea_level
                r = 10
                g = int(20 + 80 * depth)
                b = int(150 + 105 * depth)
                diffuse_map[y, x] = [r, g, b]
                specular_map[y, x] = 240 
            else:
                altitude = (final_noise - sea_level) / (1.0 - sea_level)
                specular_map[y, x] = 10
                
                if altitude < 0.05:
                    diffuse_map[y, x] = [194, 178, 128]
                    specular_map[y, x] = 30
                elif altitude < 0.5:
                    diffuse_map[y, x] = [34, 139, 34]
                elif altitude < 0.8:
                    diffuse_map[y, x] = [105, 105, 105]
                else:
                    diffuse_map[y, x] = [250, 250, 250]
                    specular_map[y, x] = 150

    # Costruzione dei percorsi usando .format()
    path_bump = os.path.join(output_folder, "{}_bump.png".format(base_name))
    path_diff = os.path.join(output_folder, "{}_diffuse.png".format(base_name))
    path_spec = os.path.join(output_folder, "{}_specular.png".format(base_name))

    # Salvataggio
    Image.fromarray(bump_map).save(path_bump)
    Image.fromarray(diffuse_map).save(path_diff)
    Image.fromarray(specular_map).save(path_spec)
    
    print("Salvato set per {} in /{}".format(base_name, output_folder))

if __name__ == "__main__":
    num_planets = 5
    for i in range(num_planets):
        current_seed = 42 + (i * 123)
        # Formattazione per avere i numeri con gli zeri davanti (es. 001, 002)
        planet_name = "planet_procedural_{:03d}".format(i)
        
        generate_planet_maps(current_seed, planet_name)

    print("Generazione batch completata.")