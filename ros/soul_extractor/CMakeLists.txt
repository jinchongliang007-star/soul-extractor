cmake_minimum_required(VERSION 3.0.2)
project(soul_extractor)

add_compile_options(-std=c++11 -O2)

find_package(catkin REQUIRED COMPONENTS
  roscpp
  sensor_msgs
  std_srvs
  pcl_ros
  pcl_conversions
)

find_package(PCL REQUIRED COMPONENTS common filters)

catkin_package(
  CATKIN_DEPENDS roscpp sensor_msgs std_srvs pcl_ros pcl_conversions
)

include_directories(${catkin_INCLUDE_DIRS} ${PCL_INCLUDE_DIRS})
add_definitions(${PCL_DEFINITIONS})

add_executable(soul_processor_node src/soul_processor_node.cpp)
target_link_libraries(soul_processor_node ${catkin_LIBRARIES} ${PCL_LIBRARIES})

install(TARGETS soul_processor_node
  RUNTIME DESTINATION ${CATKIN_PACKAGE_BIN_DESTINATION}
)
install(DIRECTORY launch/
  DESTINATION ${CATKIN_PACKAGE_SHARE_DESTINATION}/launch
)
