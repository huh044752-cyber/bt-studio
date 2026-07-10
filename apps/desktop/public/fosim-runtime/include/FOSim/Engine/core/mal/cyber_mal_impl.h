#pragma once

#include "cyber_marg_base_impl.h"
#include <vector>

struct CyberMalImplPrivate;

/**
 * \brief MAL数据容器
 * 可以存放仿真中使用的大部分数据的容器，拥有以数据类型与数据名称确定唯一数据的特性
 */

class FOSIMENGINE_API CyberMalImpl
{
public:
    /**
     * \brief 默认构造函数
     */
    CyberMalImpl();
    
    /**
     * \brief 拷贝构造函数
     */
    CyberMalImpl(const CyberMalImpl &_mal_impl);
    
    /**
     * \brief 移动构造函数
     */
    CyberMalImpl(CyberMalImpl &&_mal_impl);
    
    /**
     * \brief 拷贝赋值运算符
     */
    CyberMalImpl &operator=(const CyberMalImpl &_mal_impl);
    ~CyberMalImpl();

public:
    /**
     * \brief 创建MAL
     * 静态方法，创建一个新的MAL实例
     * 
     * \return 返回新生成的MAL指针，内存由调用者管理
     */
    static CyberMalImpl *CreateMAL();

public:
    /**
     * \fn std::vector<CyberMargBaseImpl*>& CyberMalImpl::GetMargList()const;
     *
     * \brief 获取内部存储的MargBase列表
     *
     * \author 
     * \date 2020/4/7
     *
     * \return 列表的引用，当修改返回值时会改变MAL内部数据
     */

    std::vector<CyberMargBaseImpl *> GetMargList() const;

    /**
     * \fn void CyberMalImpl::SetMargList(const std::vector<CyberMargBaseImpl*> & _cyber_marg_impl_list);
     *
     * \brief 设置新的MargBase列表
     *
     * \author 
     * \date 2020/4/7
     *
     * \param _cyber_marg_impl_list list中MargBase指针由该MAL维护
     */

    void SetMargList(const SafeVector<CyberMargBaseImpl *> &_cyber_marg_impl_list);

public:
    /**
     * \fn virtual CyberMalImpl CyberMalImpl::*Clone();
     *
     * \brief 深拷贝当前MAL创建一个相同的MAL
     *
     * \author 
     * \date 2020/4/7
     *
     * \return 新拷贝出的MAL
     */

    CyberMalImpl *Clone();

public:
    /**
     * \fn CyberRC CyberMalImpl::AddAddress(char *_name, void *_value);
     *
     * \brief 添加地址数据
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in] _name  数据输入，MargBase的名称
     * \param [in] _value 数据输入，MargBase的值
     *
     * \return 输入为空返回失败，否则返回成功
     */

    CyberRC AddAddress(const char *_name, void *_value);

    /**
     * \fn void* CyberMalImpl::GetAddress(const char *_name);
     *
     * \brief 获取地址数据
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in] _name 数据输入，MargBase的名称
     *
     * \return 不存在对应的MargBase返回空指针，否则返回MargBase中存储的地址
     */

    void *GetAddress(const char *_name);

    /**
	* \fn CyberRC GetAddress(const char *_name, void *&_value);
	*
	* \brief 获取地址数据
	*
	* \author 
	* \date 2020/4/7
	*
	* \param [in] _name 数据输入，MargBase的名称
	*
	* \return 不存在对应的MargBase返回空指针，否则返回MargBase中存储的地址
	*/

    CyberRC GetAddress(const char *_name, void *&_value);
    /**
     * \fn CyberRC CyberMalImpl::AddMal(char *_name, CyberMalImpl* _value);
     *
     * \brief 添加Mal到当前MAL中
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in] _name  数据输入，MargBase的名称
     * \param [in] _value 数据输入，MargBase的值
     *
     * \return 输入为空返回失败，否则返回成功
     */

    CyberRC AddMal(const char *_name, CyberMalImpl *_value);

    /**
     * \fn CyberMalImpl* CyberMalImpl::GetMal(const char *_arg_name);
     *
     * \brief 获取Mal指针
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in] _arg_name 数据输入，MargBase的名称
     *
     * \return 不存在对应的MargBase返回空指针，否则返回MargBase中存储的MAL地址
     */

    CyberMalImpl *GetMal(const char *_arg_name);

    /**
	* \fn CyberRC GetMal(const char *_arg_name, CyberMalImpl *&_value);
	*
	* \brief 获取Mal指针
	*
	* \author 
	* \date 2020/4/7
	*
	* \param [in] _arg_name 数据输入，MargBase的名称
	*
	* \return 不存在对应的MargBase返回空指针，否则返回MargBase中存储的MAL地址
	*/
    CyberRC GetMal(const char *_arg_name, CyberMalImpl *&_value);
    /**
     * \fn CyberRC CyberMalImpl::AddTaskIdList(const char* _name, CyberTaskIDType &_value);
     *
     * \brief 追加任务id列表
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in] _name  数据输入，MargBase的名称
     * \param [in] _value 数据输入，在对应的TaskId列表中追加
     *
     * \return 输入为空返回失败，否则返回成功
     */

    CyberRC AddTaskIdList(const char *_name, const CyberTaskIDType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetTaskIdList(const char *_name,size_t _index, CyberTaskIDType &_value);
     *
     * \brief 依据名称与索引获取任务id
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in]       _name 数据输入，MargBase的名称
     * \param            _index 数据索引
     * \param [out]      _value 数据输出
     *
     * \return 输入不存在返回失败，否则返回成功。
     */

    CyberRC GetTaskIdList(const char *_name, size_t _index, CyberTaskIDType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetTaskIdListSize(const char *_name, size_t &_size);
     *
     * \brief 获取对应名称中任务id列表中id的数量
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in]   _name 数据输入，MargBase的名称
     * \param [out]  _size 数据输出，输入名称任务id的数量
     *
     * \return 输入不存在返回失败，否则返回成功
     */

    CyberRC GetTaskIdListSize(const char *_name, size_t &_size);

    /**
     * \fn CyberRC CyberMalImpl::AddBoolean(const char * _name, const CyberBOOL& _value);
     *
     * \brief 添加布尔类型
     *
     * \author 
     * \date 2020/4/7
     *
     * \param    _name  数据输入，MargBase的名称
     * \param    _value 数据输入，布尔类型的值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddBoolean(const char *_name, const CyberBOOL &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetBoolean(const char *_arg_name, CyberBOOL& _value);
     *
     * \brief 获取布尔类型
     *
     * \author 
     * \date 2020/4/7
     *
     * \param _arg_name 数据输入，MargBase的名称
     * \param _value    数据输出，布尔类型的值
     *
     * \return 输入不存在返回失败，否则返回成功。
     */

    CyberRC GetBoolean(const char *_arg_name, CyberBOOL &_value);

    CyberBOOL GetBoolean(const char *_arg_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddCoordinate(const char *_name, const CyberCoordinateType& _value);
     *
     * \brief 添加纬经度
     *
     * \author 
     * \date 2020/4/7
     *
     * \param  _name  数据输入，MargBase的名称
     * \param  _value 数据输入，纬经度类型的值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddCoordinate(const char *_name, const CyberCoordinateType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetCoordinate(const char *_arg_name, CyberCoordinateType& _value);
     *
     * \brief 获取纬经度
     *
     * \author 
     * \date 2020/4/7
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，纬经度类型的值
     *
     * \return 输入不存在返回失败，否则返回成功。
     */

    CyberRC GetCoordinate(const char *_arg_name, CyberCoordinateType &_value);
    CyberCoordinateType GetCoordinate(const char *_arg_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddDMGRC(const char *_name, const CyberDMGRC& _value);
     *
     * \brief 添加损伤数据
     *
     * \author 
     * \date 2020/4/7
     *
     * \param        _name  数据输入，MargBase的名称
     * \param        _value 数据输入，损伤类型
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddDMGRC(const char *_name, const CyberDMGRC &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetDMGRC(const char *_arg_name, CyberDMGRC& _value);
     *
     * \brief 获取损伤数据
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，损伤类型
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetDMGRC(const char *_arg_name, CyberDMGRC &_value);
    CyberDMGRC GetDMGRC(const char *_arg_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddEngagementInfo(const char *_name, const CyberEngagementInfoType& _value);
     *
     * \brief 添加约定信息
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，约定信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddEngagementInfo(const char *_name, const CyberEngagementInfoType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetEngagementInfo(const char *_arg_name, CyberEngagementInfoType& _value);
     *
     * \brief 获取约定信息
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，约定信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetEngagementInfo(const char *_arg_name, CyberEngagementInfoType &_value);

    /**
     * \fn CyberRC CyberMalImpl::AddEquipmentID(const char *_name, const CyberEntityIDType& _value);
     *
     * \brief 添加装备ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，装备ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddEquipmentID(const char *_name, const CyberEntityIDType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetEquipmentID(const char *_arg_name, CyberEntityIDType& _value);
     *
     * \brief 获取装备ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，装备ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetEquipmentID(const char *_arg_name, CyberEntityIDType &_value);
    CyberEntityIDType GetEquipmentID(const char *_arg_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddEntityID(const char *_name, const CyberEntityIDType& _value);
     *
     * \brief 添加挂载ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，挂载ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddEntityID(const char *_name, const CyberEntityIDType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetEntityID(const char *_arg_name, CyberEntityIDType& _value);
     *
     * \brief 获取挂载ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，挂载ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetEntityID(const char *_arg_name, CyberEntityIDType &_value);
    CyberEntityIDType GetEntityID(const char *_arg_name, CyberRC *_res = nullptr);

    /**
	* \fn CyberRC AddInterID(const char *_name, const CyberInterIDType& _value);
	*
	* \brief 添加交互ID
	*
	* \author 
	* \date 2020/4/8
	*
	* \param          _name  数据输入，MargBase的名称
	* \param          _value 数据输入，整数数值
	*
	* \return 输入为空返回失败，否则返回成功。
	*/
    CyberRC AddInterID(const char *_name, const CyberInterIDType &_value);

    /**
	* \fn CyberRC CyberMalImpl::GetInterID(const char *_arg_name, CyberInterIDType& _value);
	*
	* \brief 获取交互ID
	*
	* \author 
	* \date 2020/4/8
	*
	* \param  _arg_name 数据输入，MargBase的名称
	* \param  _value    数据输出，特征ID
	*
	* \return 输入为空返回失败，否则返回成功。
	*/

    CyberRC GetInterID(const char *_arg_name, CyberInterIDType &_value);
    CyberInterIDType GetInterID(const char *_arg_name, CyberRC *_res = nullptr);

    /**
	* \fn CyberRC CyberMalImpl::AddFeatureID(const char *_name, const CyberFeatureIDType& _value);
	*
	* \brief 添加特征ID
	*
	* \author 
	* \date 2020/4/8
	*
	* \param          _name  数据输入，MargBase的名称
	* \param          _value 数据输入，整数数值
	*
	* \return 输入为空返回失败，否则返回成功。
	*/
    CyberRC AddFeatureID(const char *_name, const CyberFeatureIDType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetFeatureID(const char *_arg_name, CyberFeatureIDType& _value);
     *
     * \brief 获取特征ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，特征ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetFeatureID(const char *_arg_name, CyberFeatureIDType &_value);
    CyberFeatureIDType GetFeatureID(const char *_arg_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddInteger(const char *_name, const CyberIntegerType& _value);
     *
     * \brief 添加整数
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，整数数值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddInteger(const char *_name, const CyberIntegerType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetInteger(const char *_arg_name, CyberIntegerType& _value);
     *
     * \brief 获取整数
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，整数数值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetInteger(const char *_arg_name, CyberIntegerType &_value);
    CyberIntegerType GetInteger(const char *_arg_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddJulian(const char *_name, const CyberJulianType& _value);
     *
     * \brief 添加朱利安时间
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，朱利安时间
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddJulian(const char *_name, const CyberJulianType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetJulian(const char *_arg_name, CyberJulianType& _value);
     *
     * \brief 获取朱利安时间
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，朱利安时间
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetJulian(const char *_arg_name, CyberJulianType &_value);
    CyberJulianType GetJulian(const char *_arg_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddReal(const char *_name, const CyberRealType& _value);
     *
     * \brief 添加实数
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，实数数值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddReal(const char *_name, const CyberRealType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetReal(const char *_arg_name, CyberRealType& _value);
     *
     * \brief 获取实数
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，实数数值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetReal(const char *_arg_name, CyberRealType &_value);
    CyberRealType GetReal(const char *_arg_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddName(const char *_name,const char* _value);
     *
     * \brief 添加名字
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name  数据输入，MargBase的名称
     * \param  _value 数据输入，名称字符串
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddName(const char *_name, const char *_value);

    /**
     * \fn CyberRC CyberMalImpl::GetName(const char *_arg_name, const char* _name);
     *
     * \brief 获取名称
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _name     数据输出，名称字符串
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetName(const char *_arg_name, char *_name);
    const char *GetName(const char *_arg_name);

    /**
     * \fn CyberRC CyberMalImpl::AddPosition(char *_name, const CyberPositionType& _value);
     *
     * \brief 添加XYZ坐标
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，坐标数值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddPosition(const char *_name, const CyberPositionType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetPosition(const char *_arg_name, CyberPositionType& _value);
     *
     * \brief 获取XYZ坐标
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，XYZ坐标
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetPosition(const char *_arg_name, CyberPositionType &_value);
    CyberPositionType GetPosition(const char *_arg_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddTrackHandle(const char *_name, const CyberTrackHandleType& _value);
     *
     * \brief 添加航迹
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，航迹信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddTrackHandle(const char *_name, const CyberTrackHandleType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetTrackHandle(const char *_arg_name, CyberTrackHandleType& _value);
     *
     * \brief 获取航迹
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，航迹信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetTrackHandle(const char *_arg_name, CyberTrackHandleType &_value);

    /**
     * \fn CyberRC CyberMalImpl::AddTrackID(const char *_name, const CyberTrackIDType& _value);
     *
     * \brief 添加航迹ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，航迹ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddTrackID(const char *_name, const CyberTrackIDType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetTrackID(const char *_name, CyberTrackIDType& _value);
     *
     * \brief 获取航迹ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name  数据输入，MargBase的名称
     * \param  _value 数据输出，航迹ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetTrackID(const char *_name, CyberTrackIDType &_value);
    CyberTrackIDType GetTrackID(const char *_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddUnitID(const char *_name, const CyberEntityIDType& _value);
     *
     * \brief 添加单元ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，单元ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddUnitID(const char *_name, const CyberEntityIDType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetUnitID(char *_arg_name, CyberEntityIDType& _value);
     *
     * \brief 获取单元ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，单元ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetUnitID(const char *_arg_name, CyberEntityIDType &_value);
    CyberEntityIDType GetUnitID(const char *_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddVector(char *_name, const CyberVectorType& _value);
     *
     * \brief 添加矢量
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，矢量
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddVector(const char *_name, const CyberVectorType &_value);

    /**
     * \fn CyberRC GetOrientation(char *_arg_name, CyberOrientationType& _value);
     *
     * \brief 获取矢量
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，矢量
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetOrientation(const char *_arg_name, CyberOrientationType &_value);
    CyberOrientationType GetOrientation(const char *_arg_name, CyberRC *_res = nullptr);
    /**
	* \fn CyberRC AddOrientation(char *_name, const CyberOrientationType& _value);
	*
	* \brief 添加矢量
	*
	* \author 
	* \date 2020/4/8
	*
	* \param          _name  数据输入，MargBase的名称
	* \param          _value 数据输入，矢量
	*
	* \return 输入为空返回失败，否则返回成功。
	*/

    CyberRC AddOrientation(const char *_name, const CyberOrientationType &_value);

    /**
	* \fn CyberRC CyberMalImpl::GetVector(char *_arg_name, CyberVectorType& _value);
	*
	* \brief 获取矢量
	*
	* \author 
	* \date 2020/4/8
	*
	* \param  _arg_name 数据输入，MargBase的名称
	* \param  _value    数据输出，矢量
	*
	* \return 输入为空返回失败，否则返回成功。
	*/

    CyberRC GetVector(const char *_arg_name, CyberVectorType &_value);

    CyberVectorType GetVector(const char *_arg_name, CyberRC *_res = nullptr);

    /**
     * \fn CyberRC CyberMalImpl::AddString(char *_name, const char* _value);
     *
     * \brief 添加字符串
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，输入字符串内存不由MAL管理
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddString(const char *_name, const char *_value);

    /**
     * \fn const char* CyberMalImpl::GetString(char *_arg_name);
     *
     * \brief 获取字符串，返回值生命周期和MAL相同
     *
     * \author 
     * \date 2020/4/8
     *
     * \param _arg_name 数据输入，MargBase的名称
     *
     * \return 如果不存在返回空指针，否则返回字符指针。
     */

    const char *GetString(const char *_arg_name);

    /**
	* \fn CyberRC GetString(char *_arg_name, char* &_value);
	*
	* \brief 获取字符串，返回值生命周期和MAL相同
	*
	* \author 
	* \date 2020/4/8
	*
	* \param _arg_name 数据输入，MargBase的名称
	*
	* \return 如果不存在返回空指针，否则返回字符指针。
	*/

    CyberRC GetString(const char *_arg_name, char *&_value);

    /**
     * \fn CyberRC CyberMalImpl::AddTrackHandleList(char *_name, const CyberTrackHandleType& _value);
     *
     * \brief 追加航迹列表
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，航迹信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddTrackHandleList(const char *_name, const CyberTrackHandleType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetTrackHandleList(char *_name, size_t _index, CyberTrackHandleType& _value);
     *
     * \brief 根据索引与名称获取航迹信息
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name  数据输入，MargBase的名称
     * \param  _index 数据输入，航迹信息的索引
     * \param  _value 数据输出，航迹信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetTrackHandleList(const char *_name, size_t _index, CyberTrackHandleType &_value);

    /**
     * \fn CyberRC CyberMalImpl::GetTrackHandleListSize(char *_name, size_t& _size);
     *
     * \brief 根据名称获取目标航迹列表的数量
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name 数据输入，MargBase的名称
     * \param  _size 数据输出，航迹列表数量
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetTrackHandleListSize(const char *_name, size_t &_size);

    /**
     * \fn CyberRC CyberMalImpl::AddRecord(char *_name, void *_record, size_t _record_size, CyberRecordIDType _record_id = 0);
     *
     * \brief 添加Record
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name        数据输入，MargBase的名称
     * \param  _record      数据输入，Record数据指针
     * \param  _record_size 数据输入，Record结构体大小
     * \param  _record_id   数据输入，Record结构体ID（现在没有用到）
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddRecord(const char *_name, void *_record, size_t _record_size, CyberRecordIDType _record_id = 0);

    /**
     * \fn CyberRC CyberMalImpl::GetRecord(char *_name, void *_record, size_t &_record_size, CyberRecordIDType &_record_id);
     *
     * \brief 获取Record
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name        数据输入，MargBase的名称
     * \param  _record      数据输出，存储Record数据的首地址
     * \param  _record_size 数据输出，Record数据的大小
     * \param  _record_id   数据输出，Record数据的ID（现在没有用到，默认为0）
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC GetRecord(const char *_name, void *_record, size_t &_record_size, CyberRecordIDType &_record_id);

    /**
     * \fn CyberRC CyberMalImpl::AppendMal(CyberMalImpl *_mal_value,CyberBOOL _override = CyberBOOL::CYBER_FALSE);
     *
     * \brief 把目标MAL中数据添加到当前MAL中
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _mal_value 数据输出
     * \param  _override  是否覆盖相同数据
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddPODData(const char *_name, void *_pod_data, size_t _pod_data_size);

    CyberRC GetPODData(const char *_name, void *_pod_data, size_t &_pod_data_size);

    CyberRC AppendMal(CyberMalImpl *_mal_value);

    /**
     * \fn CyberRC CyberMalImpl::MalDestroy();
     *
     * \brief 销毁当前MAL
     *
     * \author 
     * \date 2020/4/8
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC MalDestroy();

    /**
     * \fn CyberRC CyberMalImpl::AddArgument(CyberMargBaseImpl *_margs);
     *
     * \brief 添加一个MargBase, 输入MargBase的生命周期由MAL维护
     *
     * \author 
     * \date 2020/4/8
     *
     * \param _margs 数据输入，要存储的MargBase
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC AddArgument(CyberMargBaseImpl *_margs);

    /**
     * \fn CyberRC CyberMalImpl::DropArgument(CyberMargBaseImpl *_marg_value);
     *
     * \brief 根据输入MargBase的名称与类型，删除一个MargBase。MAL中存储的对应数据会被销毁。
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _marg_value 数据输入，要销毁的MargBase信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC DropArgument(CyberMargBaseImpl *_marg_value);

    CyberRC DropArgumentByName(const char *_name, CyberMARGType _marg_type);
    /**
     * \fn CyberRC CyberMalImpl::DropArgumentList();
     *
     * \brief 清除MAL中所有的数据
     *
     * \author 
     * \date 2020/4/8
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberRC DropArgumentList();

    /**
     * \fn CyberMargBaseImpl CyberMalImpl::*GetArgumentByName(char *_arg_name, CyberMARGType _arg_type);
     *
     * \brief 通过名称与类型获取MargBase
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name MargBase 的名称
     * \param  _arg_type MargBase 的类型
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    CyberMargBaseImpl *GetArgumentByName(const char *_arg_name, CyberMARGType _arg_type);

    /**
     * \fn CyberMargBaseImpl CyberMalImpl::*GetFirstArgument();
     *
     * \brief 获取第一个MargBase
     *
     * \author 
     * \date 2020/4/8
     *
     * \return 如果MAL中存储的MargBase数量是零，返回空指针。
     */

    CyberMargBaseImpl *GetFirstArgument();
    CyberMargBaseImpl *GetLastArgument();
    /**
     * \fn CyberMargBaseImpl CyberMalImpl::*GetNextArgument(CyberMargBaseImpl *_current_arg);
     *
     * \brief 根据上一个MargBase获取下一个MargBase
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _current_arg 上一个MargBase
     *
     * \return 如果输入为空或输入不存在MAL中或输入是最后一个MargBase返回空指针，否则返回下一个MargBase
     */

    CyberMargBaseImpl *GetNextArgument(CyberMargBaseImpl *_current_arg);

    CyberMargBaseImpl *GetPreviousArgument(CyberMargBaseImpl *_current_arg);
    /**
     * \fn size_t CyberMalImpl::GetSerializeSize();
     *
     * \brief 获取序列化后的数据大小
     *
     * \author 
     * \date 2020/4/8
     *
     * \return 序列化数据大小
     */

    size_t GetSerializeSize();

    /**
     * \fn CyberRC CyberMalImpl::SerializeMal(void **_ptr, size_t &_size,size_t _pre_malloc_size = 1);
     *
     * \brief 序列化当前MAL
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _ptr             数据输出，序列化数据指针的地址
     * \param  _size            数据输出，序列化数据的大小
     * \param  _pre_malloc_size 预分配内存，默认大小为1
     *
     * \return 输入为空返回失败，否则返回成功
     */

    CyberRC SerializeMal(void **_ptr, size_t &_size, size_t _pre_malloc_size = 1);

    /**
     * \fn CyberRC CyberMalImpl::DeSerializeMal(void *_ptr, size_t _real_size);
     *
     * \brief 反序列化当前MAL
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _ptr       数据输入，原始数据
     * \param  _real_size 数据输入，原始数据的大小
     *
     * \return 输入为空或数据错误返回失败。
     */

    CyberRC DeSerializeMal(void *_ptr, size_t _real_size);

private:
    size_t GetSerializeSize(CyberMalImpl *_mal);
    size_t Serialize(const CyberMalImpl *_mal, void *_ptr);
    CyberRC DeSerialize(CyberMalImpl *_mal, void *_ptr);

private:
    CyberMalImplPrivate *cyber_mal_impl_private_;
};
