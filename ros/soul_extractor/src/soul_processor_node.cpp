#include <ros/ros.h>
#include <sensor_msgs/PointCloud2.h>
#include <std_srvs/Trigger.h>

#include <pcl/filters/voxel_grid.h>
#include <pcl/point_cloud.h>
#include <pcl/point_types.h>
#include <pcl_conversions/pcl_conversions.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <sys/stat.h>
#include <sys/types.h>

namespace {

constexpr std::size_t kBins = 12;
constexpr std::size_t kDescriptorSize = kBins * 3;
constexpr double kPi = 3.14159265358979323846;

double clamp01(double value) {
  return std::max(0.0, std::min(1.0, value));
}

struct VoxelKey {
  int x;
  int y;
  int z;

  bool operator==(const VoxelKey& other) const {
    return x == other.x && y == other.y && z == other.z;
  }
};

struct VoxelHash {
  std::size_t operator()(const VoxelKey& key) const {
    const std::size_t h1 = std::hash<int>()(key.x);
    const std::size_t h2 = std::hash<int>()(key.y);
    const std::size_t h3 = std::hash<int>()(key.z);
    return h1 ^ (h2 << 1) ^ (h3 << 7);
  }
};

std::string iso8601Now() {
  std::time_t now = std::time(nullptr);
  std::tm utc;
  gmtime_r(&now, &utc);
  char buffer[32];
  std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return buffer;
}

bool makeDirectories(const std::string& file_path) {
  const std::size_t slash = file_path.find_last_of('/');
  if (slash == std::string::npos) return true;
  const std::string dir = file_path.substr(0, slash);
  if (dir.empty()) return true;

  std::string partial;
  if (dir.front() == '/') partial = "/";
  std::stringstream stream(dir);
  std::string component;
  while (std::getline(stream, component, '/')) {
    if (component.empty()) continue;
    if (partial.size() > 1) partial += "/";
    partial += component;
    if (::mkdir(partial.c_str(), 0755) != 0 && errno != EEXIST) return false;
  }
  return true;
}

}  // namespace

class SoulProcessor {
 public:
  SoulProcessor() : nh_(), private_nh_("~") {
    private_nh_.param<std::string>("input_topic", input_topic_, "/livox/lidar");
    private_nh_.param<std::string>("output_topic", output_topic_, "/soul/filtered");
    private_nh_.param<std::string>("output_path", output_path_,
                                   "/home/jincl/soul-runtime/public/live.json");
    private_nh_.param<std::string>("state_path", state_path_,
                                   "/home/jincl/soul-runtime/private/memory.state");
    private_nh_.param("min_range", min_range_, 0.35);
    private_nh_.param("max_range", max_range_, 12.0);
    private_nh_.param("voxel_size", voxel_size_, 0.05);
    private_nh_.param("background_voxel_size", background_voxel_size_, 0.10);
    private_nh_.param("background_seconds", background_seconds_, 15.0);
    private_nh_.param("background_presence_ratio", background_presence_ratio_, 0.65);
    private_nh_.param("json_rate", json_rate_, 2.0);
    private_nh_.param("forgetting", forgetting_, 0.9995);

    descriptor_ema_.fill(0.0);
    memory_.fill(0.0);

    cloud_sub_ = nh_.subscribe(input_topic_, 1, &SoulProcessor::cloudCallback, this);
    filtered_pub_ = nh_.advertise<sensor_msgs::PointCloud2>(output_topic_, 1);
    calibrate_srv_ = nh_.advertiseService("/soul/calibrate", &SoulProcessor::calibrate, this);
    start_srv_ = nh_.advertiseService("/soul/start", &SoulProcessor::start, this);
    pause_srv_ = nh_.advertiseService("/soul/pause", &SoulProcessor::pause, this);
    end_srv_ = nh_.advertiseService("/soul/end", &SoulProcessor::end, this);

    if (!makeDirectories(output_path_)) {
      ROS_ERROR_STREAM("Cannot create output directory for " << output_path_);
    }
    if (!makeDirectories(state_path_)) {
      ROS_ERROR_STREAM("Cannot create state directory for " << state_path_);
    }
    loadState();
    writeJson(true);
    ROS_INFO_STREAM("Soul processor ready. Input=" << input_topic_
                    << " abstract state=" << output_path_);
    ROS_INFO("Manual services: /soul/calibrate, /soul/start, /soul/pause, /soul/end");
  }

 private:
  enum class State { IDLE, CALIBRATING, RECORDING, PAUSED, ENDED };

  const char* stateName() const {
    switch (state_) {
      case State::IDLE: return "idle";
      case State::CALIBRATING: return "calibrating";
      case State::RECORDING: return "recording";
      case State::PAUSED: return "paused";
      case State::ENDED: return "ended";
    }
    return "unknown";
  }

  VoxelKey keyFor(const pcl::PointXYZI& point) const {
    return VoxelKey{
        static_cast<int>(std::floor(point.x / background_voxel_size_)),
        static_cast<int>(std::floor(point.y / background_voxel_size_)),
        static_cast<int>(std::floor(point.z / background_voxel_size_))};
  }

  bool calibrate(std_srvs::Trigger::Request&, std_srvs::Trigger::Response& response) {
    background_counts_.clear();
    background_voxels_.clear();
    calibration_frames_ = 0;
    state_before_calibration_ = state_ == State::RECORDING ? State::RECORDING : State::IDLE;
    state_ = State::CALIBRATING;
    calibration_started_ = ros::WallTime::now();
    response.success = true;
    std::ostringstream message;
    message << "Background calibration started for " << background_seconds_
            << " seconds. Keep the capture area empty.";
    response.message = message.str();
    ROS_WARN_STREAM(response.message);
    return true;
  }

  bool start(std_srvs::Trigger::Request&, std_srvs::Trigger::Response& response) {
    if (state_ == State::CALIBRATING) {
      response.success = false;
      response.message = "Wait for background calibration to finish.";
      return true;
    }
    if (session_started_.isZero()) session_started_ = ros::WallTime::now();
    last_active_tick_ = ros::WallTime::now();
    state_ = State::RECORDING;
    response.success = true;
    response.message = "Existence-field recording started.";
    writeJson(true);
    return true;
  }

  bool pause(std_srvs::Trigger::Request&, std_srvs::Trigger::Response& response) {
    if (state_ != State::RECORDING) {
      response.success = false;
      response.message = "The session is not recording.";
      return true;
    }
    addActiveTime();
    state_ = State::PAUSED;
    response.success = true;
    response.message = "Existence-field recording paused.";
    writeJson(true);
    return true;
  }

  bool end(std_srvs::Trigger::Request&, std_srvs::Trigger::Response& response) {
    if (state_ == State::RECORDING) addActiveTime();
    state_ = State::ENDED;
    response.success = true;
    response.message = "Session ended; only the abstract field remains.";
    writeJson(true);
    return true;
  }

  void addActiveTime() {
    const ros::WallTime now = ros::WallTime::now();
    if (!last_active_tick_.isZero()) active_seconds_ += (now - last_active_tick_).toSec();
    last_active_tick_ = now;
  }

  void finalizeBackground() {
    const int threshold = std::max(1, static_cast<int>(std::ceil(
        static_cast<double>(calibration_frames_) * background_presence_ratio_)));
    for (const auto& item : background_counts_) {
      if (item.second >= threshold) background_voxels_.insert(item.first);
    }
    background_counts_.clear();
    background_ready_ = !background_voxels_.empty();
    state_ = state_before_calibration_;
    ROS_INFO_STREAM("Background calibration complete: " << background_voxels_.size()
                    << " persistent voxels from " << calibration_frames_ << " frames.");
  }

  void cloudCallback(const sensor_msgs::PointCloud2ConstPtr& message) {
    pcl::PointCloud<pcl::PointXYZI>::Ptr input(new pcl::PointCloud<pcl::PointXYZI>);
    pcl::fromROSMsg(*message, *input);
    source_points_ = input->size();

    pcl::PointCloud<pcl::PointXYZI>::Ptr ranged(new pcl::PointCloud<pcl::PointXYZI>);
    ranged->reserve(input->size());
    const double min_sq = min_range_ * min_range_;
    const double max_sq = max_range_ * max_range_;
    for (const auto& point : input->points) {
      if (!pcl::isFinite(point)) continue;
      const double range_sq = point.x * point.x + point.y * point.y + point.z * point.z;
      if (range_sq < min_sq || range_sq > max_sq) continue;
      ranged->push_back(point);
    }

    pcl::VoxelGrid<pcl::PointXYZI> voxel;
    voxel.setInputCloud(ranged);
    voxel.setLeafSize(voxel_size_, voxel_size_, voxel_size_);
    pcl::PointCloud<pcl::PointXYZI>::Ptr downsampled(new pcl::PointCloud<pcl::PointXYZI>);
    voxel.filter(*downsampled);

    if (state_ == State::CALIBRATING) {
      std::unordered_set<VoxelKey, VoxelHash> seen;
      for (const auto& point : downsampled->points) seen.insert(keyFor(point));
      for (const auto& key : seen) ++background_counts_[key];
      ++calibration_frames_;
      if ((ros::WallTime::now() - calibration_started_).toSec() >= background_seconds_) {
        finalizeBackground();
      }
    }

    pcl::PointCloud<pcl::PointXYZI>::Ptr foreground(new pcl::PointCloud<pcl::PointXYZI>);
    foreground->reserve(downsampled->size());
    for (const auto& point : downsampled->points) {
      if (background_ready_ && background_voxels_.count(keyFor(point)) != 0) continue;
      foreground->push_back(point);
    }
    foreground->width = foreground->size();
    foreground->height = 1;
    foreground->is_dense = false;
    filtered_points_ = foreground->size();

    sensor_msgs::PointCloud2 output;
    pcl::toROSMsg(*foreground, output);
    output.header = message->header;
    filtered_pub_.publish(output);

    if (state_ == State::RECORDING) {
      addActiveTime();
      updateDescriptors(*foreground);
    }
    writeJson(false);
  }

  void updateDescriptors(const pcl::PointCloud<pcl::PointXYZI>& cloud) {
    std::array<double, kDescriptorSize> current;
    current.fill(0.0);
    if (cloud.empty()) return;

    for (const auto& point : cloud.points) {
      const double radius = std::sqrt(point.x * point.x + point.y * point.y + point.z * point.z);
      const std::size_t radial_bin = std::min<std::size_t>(
          kBins - 1, static_cast<std::size_t>(radius / max_range_ * kBins));
      const double normalized_z = clamp01((point.z + 3.0) / 6.0);
      const std::size_t height_bin = std::min<std::size_t>(
          kBins - 1, static_cast<std::size_t>(normalized_z * kBins));
      const double normalized_intensity = clamp01(static_cast<double>(point.intensity) / 255.0);
      const std::size_t intensity_bin = std::min<std::size_t>(
          kBins - 1, static_cast<std::size_t>(normalized_intensity * kBins));
      current[radial_bin] += 1.0;
      current[kBins + height_bin] += 1.0;
      current[kBins * 2 + intensity_bin] += 1.0;
    }

    for (std::size_t group = 0; group < 3; ++group) {
      double total = 0.0;
      for (std::size_t i = 0; i < kBins; ++i) total += current[group * kBins + i];
      if (total > 0.0) {
        for (std::size_t i = 0; i < kBins; ++i) current[group * kBins + i] /= total;
      }
    }

    double change = 0.0;
    for (std::size_t i = 0; i < kDescriptorSize; ++i) {
      change += std::abs(current[i] - descriptor_ema_[i]);
      descriptor_ema_[i] = descriptor_ema_[i] * 0.86 + current[i] * 0.14;
      memory_[i] = memory_[i] * forgetting_ + descriptor_ema_[i] * (1.0 - forgetting_);
    }
    motion_ = motion_ * 0.82 + clamp01(change / 2.0) * 0.18;
    energy_ = energy_ * 0.90 + clamp01(static_cast<double>(cloud.size()) / 5500.0) * 0.10;
    ++recorded_frames_;
  }

  void writeJson(bool force) {
    const ros::WallTime now = ros::WallTime::now();
    if (!force && !last_json_write_.isZero() &&
        (now - last_json_write_).toSec() < 1.0 / std::max(0.1, json_rate_)) return;
    last_json_write_ = now;

    const std::size_t particle_count = static_cast<std::size_t>(std::min(
        1800.0, 480.0 + std::sqrt(std::max(0.0, active_seconds_)) * 34.0));
    const double phase = active_seconds_ * 0.075;
    const std::string temporary = output_path_ + ".tmp";
    std::ofstream file(temporary.c_str(), std::ios::out | std::ios::trunc);
    if (!file) {
      ROS_ERROR_THROTTLE(10.0, "Cannot write abstract state file: %s", temporary.c_str());
      return;
    }

    file << std::fixed << std::setprecision(5);
    file << "{\n";
    file << "  \"schema\": \"soul-field/v1\",\n";
    file << "  \"updated_at\": \"" << iso8601Now() << "\",\n";
    file << "  \"status\": \"" << stateName() << "\",\n";
    file << "  \"sensor\": \"Livox MID-70\",\n";
    file << "  \"privacy\": \"abstract-descriptors-only\",\n";
    file << "  \"background_calibrated\": " << (background_ready_ ? "true" : "false") << ",\n";
    file << "  \"active_seconds\": " << active_seconds_ << ",\n";
    file << "  \"source_points_live\": " << source_points_ << ",\n";
    file << "  \"filtered_points_live\": " << filtered_points_ << ",\n";
    file << "  \"recorded_frames\": " << recorded_frames_ << ",\n";
    file << "  \"energy\": " << clamp01(energy_) << ",\n";
    file << "  \"motion\": " << clamp01(motion_) << ",\n";
    file << "  \"particles\": [\n";

    const double golden_angle = kPi * (3.0 - std::sqrt(5.0));
    for (std::size_t i = 0; i < particle_count; ++i) {
      const std::size_t bin = i % kDescriptorSize;
      const double signal = clamp01(descriptor_ema_[bin] * 7.0);
      const double trace = clamp01(memory_[bin] * 9.0);
      const double normalized_i = static_cast<double>(i) / std::max<std::size_t>(1, particle_count - 1);
      const double theta = i * golden_angle + phase * (0.35 + (bin % 7) * 0.07);
      const double shell = 0.34 + 2.15 * std::sqrt(normalized_i);
      const double radius = shell * (0.86 + 0.12 * std::sin(theta * 2.3 + signal * 4.0));
      const double z = (normalized_i * 2.0 - 1.0) * (1.05 + trace * 0.95) +
                       0.24 * std::sin(theta * 1.7 + phase);
      const double x = radius * std::cos(theta) + 0.16 * std::sin(phase + bin);
      const double y = radius * std::sin(theta) + 0.13 * std::cos(phase * 0.8 + bin);
      const double intensity = clamp01(0.18 + signal * 0.58 + trace * 0.24);
      const double size = 0.55 + intensity * 1.55 + motion_ * 0.35;
      file << "    [" << x << "," << y << "," << z << "," << intensity << "," << size << "]";
      if (i + 1 != particle_count) file << ",";
      file << "\n";
    }
    file << "  ],\n";
    file << "  \"notice_zh\": \"这是由点云统计特征生成的艺术性存在记录，不是灵魂、意识或医学状态的科学证明。\"\n";
    file << "}\n";
    file.close();
    if (std::rename(temporary.c_str(), output_path_.c_str()) != 0) {
      ROS_ERROR_THROTTLE(10.0, "Cannot atomically publish abstract state: %s", std::strerror(errno));
    }
    saveState(force);
  }

  void loadState() {
    std::ifstream file(state_path_.c_str());
    if (!file) return;
    std::string version;
    std::getline(file, version);
    if (version != "SOUL_MEMORY_V1") {
      ROS_WARN_STREAM("Ignoring unknown memory state in " << state_path_);
      return;
    }
    file >> active_seconds_ >> energy_ >> motion_ >> recorded_frames_;
    for (std::size_t i = 0; i < kDescriptorSize; ++i) file >> memory_[i];
    for (std::size_t i = 0; i < kDescriptorSize; ++i) file >> descriptor_ema_[i];
    if (!file.fail()) {
      ROS_INFO_STREAM("Restored abstract memory: " << active_seconds_
                      << " active seconds and " << recorded_frames_ << " frames.");
    }
  }

  void saveState(bool force) {
    const ros::WallTime now = ros::WallTime::now();
    if (!force && !last_state_write_.isZero() &&
        (now - last_state_write_).toSec() < 30.0) return;
    last_state_write_ = now;
    const std::string temporary = state_path_ + ".tmp";
    std::ofstream file(temporary.c_str(), std::ios::out | std::ios::trunc);
    if (!file) return;
    file << std::setprecision(17);
    file << "SOUL_MEMORY_V1\n";
    file << active_seconds_ << " " << energy_ << " " << motion_ << " " << recorded_frames_ << "\n";
    for (const double value : memory_) file << value << " ";
    file << "\n";
    for (const double value : descriptor_ema_) file << value << " ";
    file << "\n";
    file.close();
    if (std::rename(temporary.c_str(), state_path_.c_str()) != 0) {
      ROS_ERROR_THROTTLE(10.0, "Cannot save abstract memory state: %s", std::strerror(errno));
    }
  }

  ros::NodeHandle nh_;
  ros::NodeHandle private_nh_;
  ros::Subscriber cloud_sub_;
  ros::Publisher filtered_pub_;
  ros::ServiceServer calibrate_srv_;
  ros::ServiceServer start_srv_;
  ros::ServiceServer pause_srv_;
  ros::ServiceServer end_srv_;

  std::string input_topic_;
  std::string output_topic_;
  std::string output_path_;
  std::string state_path_;
  double min_range_;
  double max_range_;
  double voxel_size_;
  double background_voxel_size_;
  double background_seconds_;
  double background_presence_ratio_;
  double json_rate_;
  double forgetting_;

  State state_ = State::IDLE;
  State state_before_calibration_ = State::IDLE;
  ros::WallTime calibration_started_;
  ros::WallTime session_started_;
  ros::WallTime last_active_tick_;
  ros::WallTime last_json_write_;
  ros::WallTime last_state_write_;
  std::size_t calibration_frames_ = 0;
  std::size_t source_points_ = 0;
  std::size_t filtered_points_ = 0;
  std::uint64_t recorded_frames_ = 0;
  double active_seconds_ = 0.0;
  double energy_ = 0.0;
  double motion_ = 0.0;
  bool background_ready_ = false;
  std::array<double, kDescriptorSize> descriptor_ema_;
  std::array<double, kDescriptorSize> memory_;
  std::unordered_map<VoxelKey, int, VoxelHash> background_counts_;
  std::unordered_set<VoxelKey, VoxelHash> background_voxels_;
};

int main(int argc, char** argv) {
  ros::init(argc, argv, "soul_processor");
  SoulProcessor processor;
  ros::spin();
  return 0;
}
