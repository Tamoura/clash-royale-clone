// Inverted-hull outline: renders expanded back-faces in a dark colour behind
// the lit mesh, giving the chunky-cartoon edge the native build has. Kept simple
// for WebGL/GLES3. Added to Always Included Shaders by the WebGL build script.
Shader "CR/Outline"
{
    Properties
    {
        _OutlineColor ("Outline Color", Color) = (0.04, 0.05, 0.09, 1)
        _OutlineWidth ("Outline Width", Float) = 0.035
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry+1" }
        Pass
        {
            Name "OUTLINE"
            Cull Front
            ZWrite On

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            float _OutlineWidth;
            fixed4 _OutlineColor;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
            };

            v2f vert(appdata v)
            {
                v2f o;
                float3 norm = normalize(v.normal);
                v.vertex.xyz += norm * _OutlineWidth;
                o.pos = UnityObjectToClipPos(v.vertex);
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                return _OutlineColor;
            }
            ENDCG
        }
    }
}
