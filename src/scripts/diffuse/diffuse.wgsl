struct StagingBuffer {
    iMouse: vec2<f32>,
    iTime: f32,
    iFrame: f32
};

@group(0) @binding(0) var img_input: texture_2d<f32>;
@group(0) @binding(1) var img_output: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var<uniform> staging: StagingBuffer;

const PI = 3.14159265359;
const SAMPLES = 10;
const MAXDEPTH = 4;

struct Ray {
    origin: vec3<f32>,
    direction: vec3<f32>
};

struct Triangle {
    v0 : i32,
    v1 : i32,
    v2 : i32,
    material : i32
};

/*
// Another triangle type, which might by better for intersection calculation
struct Triangle {
    v0: vec3<f32>,
    edgeA: vec3<f32>,
    edgeB: vec3<f32>,
    n : vec3<f32>
};
*/

struct Material {
    color: vec3<f32>,
    emission : f32,
};

const NTRIANGLES = 40;

@group(1) @binding(0) var<storage> coordinates: array<vec3<f32>>;
@group(1) @binding(1) var<storage> triangles: array<Triangle>;
@group(1) @binding(2) var<storage> materials: array<Material>;

struct Hit_record {
    t: f32,
    normal : vec3<f32>,
    material: i32
};

struct Camera {
    origin : vec3<f32>,
    lower_left_corner: vec3<f32>,
    horizontal : vec3<f32>,
    vertical : vec3<f32>,
    u : vec3<f32>,
    v : vec3<f32>,
    w : vec3<f32>,
    lens_radius: f32
}

var<private> g_seed: f32;
var<private> seed: vec3<f32>;

fn base_hash(p: vec2<u32>) -> u32 {
    let p_: vec2<u32> = 1103515245u*((p >> vec2<u32>(1u))^(p.yx));
    let h32: u32 = 1103515245u*((p.x)^(p.y>>3u));
    return h32^(h32 >> 16);
}

fn InitRandom(fragCoord: vec2f, iFrame: i32, iTime: f32) {
    seed = vec3f(fragCoord, f32(iFrame));
    g_seed = f32(base_hash(bitcast<vec2<u32>>(fragCoord)))/f32(0xffffffffu)+iTime;
}

fn getRandom() -> f32 {
    seed = fract(sin(cross(seed, vec3f(12.9898, 78.233, 43.1931))) * 43758.5453);
    return seed.x;
}

fn hash2() -> vec2f {
    let n: u32 = base_hash(bitcast<vec2<u32>>(vec2f(g_seed, g_seed+0.1)));
    g_seed += .2;
    let rz = vec2<u32>(n, n*48271u);
    return vec2f(rz.xy & vec2<u32>(0x7fffffffu))/f32(0x7fffffff);
}
/*
fn hash3() -> vec3<f32> {
    let n: u32 = base_hash(bitcast<vec2<u32>>(vec2(g_seed, g_seed+0.1)));
    g_seed += .2;
    uvec3 rz = uvec3(n, n*16807u, n*48271u);
    return vec3(rz & uvec3(0x7fffffffu))/float(0x7fffffff);
}
*/
fn random_in_unit_disk() -> vec2<f32> {
    let h: vec2f = hash2() * vec2(1.,6.28318530718);
    let phi: f32 = h.y;
    let r: f32 = sqrt(h.x);
	return r * vec2(sin(phi), cos(phi));
}

fn camera_const(lookfrom: vec3f, lookat: vec3f, vup: vec3f, vfov: f32, aspect: f32, aperture: f32, focus_dist: f32) -> Camera {
    var cam: Camera;
    cam.lens_radius = aperture / 2.;
    let theta: f32 = vfov*3.14159265359/180.;
    let half_height: f32 = tan(theta/2.);
    let half_width: f32 = aspect * half_height;
    cam.origin = lookfrom;
    cam.w = normalize(lookfrom - lookat);
    cam.u = normalize(cross(vup, cam.w));
    cam.v = cross(cam.w, cam.u);
    cam.lower_left_corner = cam.origin  - half_width*focus_dist*cam.u -half_height*focus_dist*cam.v - focus_dist*cam.w;
    cam.horizontal = 2.*half_width*focus_dist*cam.u;
    cam.vertical = 2.*half_height*focus_dist*cam.v;
    return cam;
}

fn camera_get_ray(c: Camera, uv: vec2f) -> Ray {
    let rd: vec2f = c.lens_radius*random_in_unit_disk();
    let offset: vec3f = c.u * rd.x + c.v * rd.y;
    return Ray(c.origin + offset,
               normalize(c.lower_left_corner + uv.x*c.horizontal + uv.y*c.vertical - c.origin - offset));
}

fn triIntersect(ray: Ray, v0: vec3f, v1: vec3f, v2: vec3f, rec: ptr<function, Hit_record>) -> bool {
    let v1v0: vec3f = v1 - v0;
    let v2v0: vec3f = v2 - v0;
    let rov0: vec3f = ray.origin - v0;

    // The four determinants above have lots of terms in common. Knowing the changing
    // the order of the columns/rows doesn't change the volume/determinant, and that
    // the volume is dot(cross(a,b,c)), we can precompute some common terms and reduce
    // it all to:
    let n: vec3f = cross( v1v0, v2v0 );
    let q: vec3f = cross( rov0, ray.direction );
    let d: f32 = 1.0/dot( ray.direction, n );
    let u: f32 = d*dot( -q, v2v0 );
    let v: f32 = d*dot(  q, v1v0 );
    var t: f32 = d*dot( -n, rov0 );

    *rec = Hit_record(t, n, 0); // material unknown

    t = min(u, min(v, min(1.0-(u+v), t)));
    return t>1e-6;
}

fn getHemisphereUniformSample(n: vec3f) -> vec3f {
    let cosTheta: f32 = getRandom();
    let sinTheta: f32 = sqrt(1. - cosTheta * cosTheta);
    let phi: f32 = 2. * PI * getRandom();

    // Spherical to cartesian
    let t: vec3f = normalize(cross(n.yzx, n));
    let b: vec3f = cross(n, t);

	return (t * cos(phi) + b * sin(phi)) * sinTheta + n * cosTheta;
}

fn world_hit(r: Ray, rec: ptr<function, Hit_record>) -> bool {
    var isHit: bool = false;
    (*rec).t = 1e20;

    for (var i=0; i<NTRIANGLES; i++) {
        var tri_hit: Hit_record;
        if (triIntersect(r,
            coordinates[triangles[i].v0 - 1],
            coordinates[triangles[i].v1 - 1],
            coordinates[triangles[i].v2 - 1],
            &tri_hit)) {
            if (tri_hit.t < (*rec).t) {
                isHit = true;
                *rec = tri_hit;
                (*rec).material = triangles[i].material;
            }
        }
    }
    (*rec).normal = normalize((*rec).normal);
    return isHit;
}

fn recurse(ray_: Ray) -> vec3f {
    var ray: Ray = ray_;
    var acc = vec3f(0.);    // Cumulative radiance
    var att = vec3f(1.);    // Light attenuation

    for (var depth = 0; depth < MAXDEPTH; depth++) {
        var hit: Hit_record;

        if (!world_hit(ray, &hit)) {
            break;
        }

        // Emissive radiance
        acc += att * materials[hit.material].emission;

        // Orient normal towards ray direction
        var facingNormal: vec3f = hit.normal * sign(-dot(hit.normal, ray.direction));

        // Lambert material
        let reflected: vec3f = getHemisphereUniformSample(facingNormal);
        att *= materials[hit.material].color * dot(facingNormal, reflected);
        let p: vec3f = ray.origin + ray.direction * hit.t;
        ray = Ray(p, reflected);
    }

    return acc;
    /*
    var hit: Hit_record;
    if (world_hit(ray, &hit)) {
        return materials[hit.material].color;
    }
    return vec3(0.);
    */
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    var iResolution = vec2f(textureDimensions(img_output));
    var fragCoord = vec2f(global_id.xy) + 0.5;

    InitRandom(fragCoord, i32(staging.iFrame), staging.iTime);
    let previousColor: vec3f = textureLoad(img_input, vec2<i32>(global_id.xy), 0).rgb;

    let aspect : f32 = iResolution.x/iResolution.y;

    var mousey: f32 = staging.iMouse.y;
    if (mousey == 0.) {
        mousey = iResolution.y*0.5;
    }

    let lookfrom = vec3f(5.*cos(staging.iMouse.x*0.01), 5.*sin(staging.iMouse.x*0.01), (mousey - iResolution.y*0.5)*0.03);
    let lookat = vec3f(0.0, 0.0, 0.0);
    let up = vec3f(0, 0, 1.);
    let cam: Camera = camera_const(lookfrom, lookat, up, 40., aspect, .05, 5.);

    let uv : vec2f = fragCoord/iResolution.xy;

    var col = vec3f(0.);
    for(var i=0; i<SAMPLES; i++) {
        let r: Ray = camera_get_ray(cam, uv);
        col += recurse(r);
    }
    col = mix(previousColor, col / f32(SAMPLES), 1. / (staging.iFrame + 1.));

    textureStore(img_output, vec2i(global_id.xy), vec4f(col, 1.));
}