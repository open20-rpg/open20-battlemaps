// Heat haze: the texture wobbles with time.
uniform float uStrength;
void main(void) {
  vec2 uv = vTextureCoord;
  uv.x += sin(uv.y * 40.0 + uTime * 3.0) * 0.004 * uStrength;
  finalColor = texture(uTexture, uv);
}
