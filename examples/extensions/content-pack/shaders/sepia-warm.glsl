// Warm sepia over the whole map.
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  float l = dot(c.rgb, vec3(0.3, 0.59, 0.11));
  finalColor = vec4(vec3(l * 1.07, l * 0.92, l * 0.74), c.a);
}
